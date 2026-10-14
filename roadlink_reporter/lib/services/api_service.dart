import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

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
  })  : baseUrl = (baseUrl ?? const String.fromEnvironment('ROADLINK_API'))
            .replaceFirst(RegExp(r'/+$'), ''),
        _client = client ?? http.Client();

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

    final photoPath = draft.photoPath;
    if (photoPath != null && photoPath.isNotEmpty) {
      try {
        final request = http.MultipartRequest(
          'POST',
          _apiUri('/incidents/${Uri.encodeComponent(saved.id!)}/photo'),
        )..files.add(await http.MultipartFile.fromPath('photo', photoPath));
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
    } on SocketException catch (error) {
      throw ApiException('Could not connect to RoadLink Core: $error');
    } on http.ClientException catch (error) {
      throw ApiException('RoadLink Core request failed: $error');
    }
  }

  Incident _decodeIncident(http.Response response, String operation) {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ApiException(
        'Could not $operation: server returned ${response.statusCode}.',
      );
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
