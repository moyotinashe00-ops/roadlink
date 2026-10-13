import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as sio;

import 'models.dart';

enum RealtimeStatus { online, offline, expired }

/// kind: 'new' | 'update' | 'unassigned'
class RealtimeEvent {
  final String kind;
  final String? event; // e.g. ambulance_assigned, police_declined
  final Incident? incident;
  final String? incidentId;
  const RealtimeEvent({required this.kind, this.event, this.incident, this.incidentId});
}

/// Live feed from RoadLink Core. The server only sends this user the incidents assigned to them.
class RealtimeClient {
  RealtimeClient({required this.baseUrl, required this.token});

  final String baseUrl;
  final String token;
  final _events = StreamController<RealtimeEvent>.broadcast();
  final _status = StreamController<RealtimeStatus>.broadcast();
  sio.Socket? _socket;

  Stream<RealtimeEvent> get events => _events.stream;
  Stream<RealtimeStatus> get status => _status.stream;

  void connect() {
    final socket = sio.io(
      baseUrl,
      sio.OptionBuilder().setTransports(['websocket']).setAuth({'token': token}).disableAutoConnect().build(),
    );
    _socket = socket;

    socket.onConnect((_) => _status.add(RealtimeStatus.online));
    socket.onDisconnect((_) => _status.add(RealtimeStatus.offline));
    socket.onConnectError((err) => _status.add(err.toString().contains('unauthorized') ? RealtimeStatus.expired : RealtimeStatus.offline));
    socket.on('auth:expired', (_) => _status.add(RealtimeStatus.expired));

    void incidentEvent(String kind, dynamic data) {
      try {
        final m = Map<String, dynamic>.from(data as Map);
        _events.add(RealtimeEvent(
          kind: kind,
          event: m['event'] as String?,
          incident: Incident.fromJson(Map<String, dynamic>.from(m['incident'] as Map)),
        ));
      } catch (_) {
        // A malformed payload must never take the live feed down.
      }
    }

    socket.on('incident:new', (d) => incidentEvent('new', d));
    socket.on('incident:update', (d) => incidentEvent('update', d));
    socket.on('incident:unassigned', (d) {
      try {
        final id = Map<String, dynamic>.from(d as Map)['incident_id'] as String;
        _events.add(RealtimeEvent(kind: 'unassigned', incidentId: id));
      } catch (_) {}
    });

    socket.connect();
  }

  void dispose() {
    _socket?.dispose();
    _events.close();
    _status.close();
  }
}
