import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart' show MediaType;

import '../models/incident.dart';

class ApiException implements Exception {
  final String message;
  ApiException(this.message);

  @override
  String toString() => message;
}

class PhotoUploadException implements Exception {
  final Incident incident;
  final String message;

  PhotoUploadException(this.incident, this.message);

  @override
  String toString() => message;
}

/// RoadLink Core HTTP client shared by Reporter and the responder apps.
class ApiService {
  ApiService({
    String? baseUrl,
    http.Client? client,
    this.pollInterval = const Duration(seconds: 5),
  })  : baseUrl = (baseUrl ?? _defaultBaseUrl).replaceFirst(RegExp(r'/+$'), ''),
        _client = client ?? http.Client();

  /// Set at build time with --dart-define=ROADLINK_API=http://host:3000. A browser build falls back to a
  /// Core running on the same machine, so `flutter run -d chrome` works without extra flags.
  static const String _defaultBaseUrl = String.fromEnvironment(
    'ROADLINK_API',
    defaultValue: kIsWeb ? 'http://localhost:3000' : '',
  );

  final String baseUrl;
  final http.Client _client;
  final Duration pollInterval;

  void close() => _client.close();

  Uri _apiUri(String path) {
    if (baseUrl.isEmpty) {
      throw ApiException(
        'RoadLink Core is not configured. Set ROADLINK_API to the Core host URL.',
      );
    }
    return Uri.parse('$baseUrl/api/v1$path');
  }

  Future<Incident> submitIncident(Incident draft) async {
    final response = await _send(
      () => _client.post(
        _apiUri('/incidents'),
        headers: const {'Content-Type': 'application/json'},
        body: jsonEncode(draft.toJson()),
      ),
    );
    final saved = _decodeIncident(response, 'create incident');
    if (saved.id == null || saved.id!.isEmpty) {
      throw ApiException('RoadLink Core created the report without an incident ID.');
    }

    // The photo travels as bytes, not as a file path: a browser has no file system to read a path from.
    final photoBytes = draft.photoBytes;
    if (photoBytes != null && photoBytes.isNotEmpty) {
      try {
        final type = _imageType(photoBytes);
        final request = http.MultipartRequest(
          'POST',
          _apiUri('/incidents/${Uri.encodeComponent(saved.id!)}/photo'),
        )..files.add(
            http.MultipartFile.fromBytes(
              'photo',
              photoBytes,
              filename: type.subtype == 'jpeg' ? 'photo.jpg' : 'photo.${type.subtype}',
              contentType: type,
            ),
          );
        final photoResponse = await _send(() => _client.send(request));
        if (photoResponse.statusCode < 200 || photoResponse.statusCode >= 300) {
          throw ApiException(
            'Photo upload returned ${photoResponse.statusCode}.',
          );
        }
        await photoResponse.stream.drain<void>();
      } catch (error) {
        throw PhotoUploadException(
          saved,
          'Your report was sent, but the photo could not be uploaded. '
          'Do not send the report again. You can continue to live status. '
          'Details: $error',
        );
      }
    }
    return saved;
  }

  Stream<Incident> watchIncident(Incident incident) {
    final id = incident.id;
    if (id == null || id.isEmpty) {
      return Stream<Incident>.error(
        ApiException('Cannot watch a report without an incident ID.'),
      );
    }

    late final StreamController<Incident> controller;
    Timer? timer;
    var requestInProgress = false;

    Future<void> refresh() async {
      if (controller.isClosed || requestInProgress) return;
      requestInProgress = true;
      try {
        final response = await _send(
          () => _client.get(
            _apiUri('/incidents/${Uri.encodeComponent(id)}'),
          ),
        );
        final updated = _decodeIncident(response, 'refresh incident');
        if (controller.isClosed) return;
        controller.add(updated);
        if (updated.status == IncidentStatus.admitted ||
            updated.status == IncidentStatus.closed) {
          timer?.cancel();
          await controller.close();
        }
      } catch (error, stackTrace) {
        if (!controller.isClosed) {
          controller.addError(error, stackTrace);
        }
      } finally {
        requestInProgress = false;
      }
    }

    controller = StreamController<Incident>(
      onListen: () {
        unawaited(refresh());
        timer = Timer.periodic(pollInterval, (_) => unawaited(refresh()));
      },
      onCancel: () => timer?.cancel(),
    );
    return controller.stream;
  }

  Future<T> _send<T>(Future<T> Function() request) async {
    try {
      return await request().timeout(const Duration(seconds: 20));
    } on ApiException {
      rethrow;
    } on TimeoutException {
      throw ApiException('RoadLink Core did not respond in time.');
    } on http.ClientException catch (error) {
      throw ApiException('RoadLink Core request failed: $error');
    } on Exception catch (error) {
      // On phones a network failure is a SocketException from dart:io, which does not exist in a browser.
      throw ApiException('Could not connect to RoadLink Core: $error');
    }
  }

  /// Works out the real image type from the first bytes, because a browser file has no extension to go by.
  static MediaType _imageType(Uint8List b) {
    if (b.length > 3 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47) {
      return MediaType('image', 'png');
    }
    if (b.length > 11 &&
        b[0] == 0x52 && b[1] == 0x49 && b[2] == 0x46 && b[3] == 0x46 &&
        b[8] == 0x57 && b[9] == 0x45 && b[10] == 0x42 && b[11] == 0x50) {
      return MediaType('image', 'webp');
    }
    return MediaType('image', 'jpeg');
  }

  /// RoadLink Core errors look like {"error": {"code": "...", "message": "..."}}.
  /// Keep that message (for example the rate-limit advice to call dispatch) instead of
  /// showing only a bare status code. Non-JSON bodies, such as from a proxy, fall back
  /// to the status code alone.
  String _failureMessage(http.Response response, String operation) {
    final base = 'Could not $operation: server returned ${response.statusCode}.';
    try {
      final decoded = jsonDecode(response.body);
      final error = decoded is Map<String, dynamic> ? decoded['error'] : null;
      final message = error is Map<String, dynamic> ? error['message'] : null;
      if (message is String && message.trim().isNotEmpty) {
        return '$base ${message.trim()}';
      }
    } on FormatException {
      // Not JSON: use the status code only.
    }
    return base;
  }

  Incident _decodeIncident(http.Response response, String operation) {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ApiException(_failureMessage(response, operation));
    }
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is! Map<String, dynamic>) {
        throw const FormatException('Expected a JSON object.');
      }
      return Incident.fromJson(decoded);
    } on FormatException catch (error) {
      throw ApiException('RoadLink Core returned an invalid report: $error');
    } on TypeError catch (error) {
      throw ApiException('RoadLink Core returned an invalid report: $error');
    }
  }
}
