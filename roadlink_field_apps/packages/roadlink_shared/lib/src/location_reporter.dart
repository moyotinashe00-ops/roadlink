import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';

/// Streams the device position to dispatch. Sends at most every [minInterval] while moving, and a
/// heartbeat every [heartbeat] while stationary, so a parked-up ambulance is not shown as "stale"
/// in the dispatcher's recommendations.
class LocationReporter {
  LocationReporter({
    required this.send,
    this.foregroundService = false,
    this.minInterval = const Duration(seconds: 15),
    this.heartbeat = const Duration(seconds: 60),
  });

  final Future<void> Function(double lat, double lng) send;

  /// Android only: keeps location running with the screen off (shows a persistent notification).
  final bool foregroundService;
  final Duration minInterval;
  final Duration heartbeat;

  final ValueNotifier<LatLng?> position = ValueNotifier<LatLng?>(null);
  final ValueNotifier<String?> problem = ValueNotifier<String?>(null);

  StreamSubscription<Position>? _sub;
  Timer? _beat;
  DateTime _lastSent = DateTime.fromMillisecondsSinceEpoch(0);

  LocationSettings _settings() {
    if (foregroundService && defaultTargetPlatform == TargetPlatform.android) {
      return AndroidSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 20,
        intervalDuration: const Duration(seconds: 10),
        foregroundNotificationConfig: const ForegroundNotificationConfig(
          notificationTitle: 'RoadLink on duty',
          notificationText: 'Sharing your location with dispatch',
          enableWakeLock: true,
        ),
      );
    }
    return const LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 20);
  }

  Future<void> start() async {
    if (_sub != null) return;
    if (!await Geolocator.isLocationServiceEnabled()) {
      problem.value = 'Location is off. Dispatch cannot see where you are.';
      return;
    }
    var perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
    if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
      problem.value = 'Location permission denied. Dispatch cannot see where you are.';
      return;
    }
    problem.value = null;

    _sub = Geolocator.getPositionStream(locationSettings: _settings()).listen(
      _onPosition,
      onError: (_) => problem.value = 'Lost the GPS signal.',
    );
    _beat = Timer.periodic(heartbeat, (_) => _push(force: true));
  }

  void _onPosition(Position p) {
    position.value = LatLng(p.latitude, p.longitude);
    problem.value = null;
    _push();
  }

  Future<void> _push({bool force = false}) async {
    final p = position.value;
    if (p == null) return;
    final now = DateTime.now();
    if (!force && now.difference(_lastSent) < minInterval) return;
    _lastSent = now;
    try {
      await send(p.latitude, p.longitude);
    } catch (_) {
      // Best effort: the next fix or heartbeat will try again.
    }
  }

  Future<void> stop() async {
    await _sub?.cancel();
    _sub = null;
    _beat?.cancel();
    _beat = null;
  }
}
