import 'dart:async';

import 'package:flutter/foundation.dart';

import 'api_client.dart';
import 'location_reporter.dart';
import 'models.dart';
import 'realtime.dart';
import 'session.dart';

enum LiveStatus { connecting, online, offline }

/// One controller per running app. It owns the session, the live feed (with a polling fallback while
/// the socket is down — SRS §7.3), location sharing, and every action the crew can take.
class FieldController extends ChangeNotifier {
  FieldController({required this.role, required this.baseUrl, SessionStore? store}) : _store = store ?? SessionStore() {
    api = RoadLinkApi(
      baseUrl: baseUrl,
      tokenProvider: () => _token,
      onUnauthorized: () {
        if (_token != null) signOut(notice: 'Your session expired. Please sign in again.');
      },
    );
  }

  final FieldRole role;
  final String baseUrl;
  final SessionStore _store;
  late final RoadLinkApi api;

  String? _token;
  AppUser? user;
  MyResource? me;
  String? notice; // shown on the login screen after a forced sign-out
  String? lastError; // shown in the live banner
  bool restoring = true;
  bool busy = false;
  LiveStatus live = LiveStatus.connecting;
  LocationReporter? location;

  final Map<String, Incident> _incidents = {};
  RealtimeClient? _rt;
  StreamSubscription<RealtimeEvent>? _eventSub;
  StreamSubscription<RealtimeStatus>? _statusSub;
  Timer? _poll;
  bool _disposed = false;

  final StreamController<Incident> _alerts = StreamController<Incident>.broadcast();

  /// Fires when an incident appears that was not on this device before (a new alert / job).
  Stream<Incident> get alerts => _alerts.stream;

  bool get signedIn => _token != null && user != null;
  bool get isAvailable => me?.isAvailable ?? false;
  Incident? incident(String id) => _incidents[id];

  /// Open incidents, most severe first, then oldest first.
  List<Incident> get incidents {
    final list = _incidents.values.where((i) => !i.isClosed).toList();
    list.sort((a, b) {
      final s = b.severity.index.compareTo(a.severity.index);
      if (s != 0) return s;
      return (a.createdAt ?? DateTime(0)).compareTo(b.createdAt ?? DateTime(0));
    });
    return list;
  }

  // ---- session ------------------------------------------------------------
  Future<void> restore() async {
    final s = await _store.load();
    if (s != null && s.user.role == role.apiRole) {
      _token = s.token;
      user = s.user;
      try {
        user = await api.me();
      } on ApiException catch (e) {
        // Offline at launch: keep the saved session and try again. Anything else (401) means it is invalid.
        if (!e.isNetwork) await _forget();
      }
    }
    if (signedIn) await _begin();
    restoring = false;
    _notify();
  }

  Future<void> signIn(String identifier, String password) async {
    final r = await api.login(identifier, password);
    if (r.user.role != role.apiRole) {
      throw ApiException(
        403,
        'WRONG_ROLE',
        role == FieldRole.police ? 'This app is for police officers.' : 'This app is for ambulance crews.',
      );
    }
    _token = r.token;
    user = r.user;
    notice = null;
    await _store.save(SessionData(r.token, r.user));
    await _begin();
    _notify();
  }

  Future<void> signOut({String? notice}) async {
    await _teardown();
    await _forget();
    this.notice = notice;
    _notify();
  }

  Future<void> _forget() async {
    _token = null;
    user = null;
    me = null;
    _incidents.clear();
    await _store.clear();
  }

  // ---- live data ------------------------------------------------------------
  Future<void> _begin() async {
    final rt = RealtimeClient(baseUrl: baseUrl, token: _token!);
    _rt = rt;
    _eventSub = rt.events.listen(_onEvent);
    _statusSub = rt.status.listen(_onStatus);
    live = LiveStatus.connecting;
    rt.connect();

    location = LocationReporter(
      send: (lat, lng) => api.sendLocation(role, lat, lng),
      foregroundService: role == FieldRole.ambulance,
    );
    location!.problem.addListener(_notify); // surface GPS trouble in the banner
    unawaited(location!.start());

    _poll = Timer.periodic(const Duration(seconds: 15), (_) {
      if (live != LiveStatus.online) refresh();
    });
    await refresh();
  }

  Future<void> _teardown() async {
    _poll?.cancel();
    _poll = null;
    await _eventSub?.cancel();
    await _statusSub?.cancel();
    _eventSub = null;
    _statusSub = null;
    _rt?.dispose();
    _rt = null;
    await location?.stop();
    location = null;
  }

  Future<void> refresh() async {
    try {
      final list = await api.listIncidents();
      _incidents
        ..clear()
        ..addEntries(list.map((i) => MapEntry(i.id, i)));
      me = await api.myResource(role);
      lastError = null;
    } on ApiException catch (e) {
      lastError = e.message;
    }
    _notify();
  }

  Future<void> _refreshMe() async {
    try {
      me = await api.myResource(role);
      _notify();
    } on ApiException {
      // non-critical
    }
  }

  void _onStatus(RealtimeStatus s) {
    switch (s) {
      case RealtimeStatus.expired:
        signOut(notice: 'Your session expired. Please sign in again.');
        return;
      case RealtimeStatus.online:
        live = LiveStatus.online;
        refresh(); // catch up on anything missed while disconnected
        break;
      case RealtimeStatus.offline:
        live = LiveStatus.offline;
        break;
    }
    _notify();
  }

  void _onEvent(RealtimeEvent e) {
    if (e.kind == 'unassigned') {
      _incidents.remove(e.incidentId);
      _notify();
      return;
    }
    final inc = e.incident;
    if (inc == null) return;
    final isNewToMe = !_incidents.containsKey(inc.id);
    if (inc.isClosed) {
      _incidents.remove(inc.id);
    } else {
      _incidents[inc.id] = inc;
      if (isNewToMe) _alerts.add(inc);
    }
    unawaited(_refreshMe()); // accept/clear/close change the on-duty state
    _notify();
  }

  // ---- actions ----------------------------------------------------------------
  Future<T> _act<T>(Future<T> Function() f) async {
    busy = true;
    _notify();
    try {
      return await f();
    } finally {
      busy = false;
      _notify();
    }
  }

  void _put(Incident i) {
    if (i.isClosed) {
      _incidents.remove(i.id);
    } else {
      _incidents[i.id] = i;
    }
  }

  Future<void> policeAccept(String id) => _act(() async {
        _put(await api.policeAccept(id));
        await _refreshMe();
      });

  Future<void> policeOnScene(String id) => _act(() async {
        _put(await api.policeOnScene(id));
        await _refreshMe();
      });

  Future<void> policeClear(String id) => _act(() async {
        _put(await api.policeClear(id));
        await _refreshMe();
      });

  /// Returns the name of the unit the incident was reassigned to (null if nobody else is available).
  Future<String?> policeDecline(String id, String reason) => _act(() async {
        final to = await api.policeDecline(id, reason);
        _incidents.remove(id);
        return to;
      });

  Future<void> sceneUpdate(String id, {int? victims, String? hazard, Severity? severity}) => _act(() async {
        _put(await api.sceneUpdate(id, verifiedVictimCount: victims, hazardNotes: hazard, severity: severity));
      });

  Future<void> caseReference(String id, String reference) => _act(() async {
        _put(await api.caseReference(id, reference));
      });

  Future<void> ambulanceStatus(String id, String status) => _act(() async {
        _put(await api.ambulanceStatus(id, status));
      });

  Future<void> recordVitals(
    String id, {
    int? pulseBpm,
    int? systolicBp,
    int? diastolicBp,
    int? spo2Percent,
    String? consciousness,
  }) =>
      _act(() async {
        _put(await api.recordVitals(
          id,
          pulseBpm: pulseBpm,
          systolicBp: systolicBp,
          diastolicBp: diastolicBp,
          spo2Percent: spo2Percent,
          consciousness: consciousness,
        ));
      });

  Future<void> setAvailable(bool available) => _act(() async {
        final ok = await api.setAvailable(role, available);
        final m = me;
        if (m != null) me = MyResource(id: m.id, label: m.label, isAvailable: ok);
      });

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _teardown();
    _alerts.close();
    api.close();
    super.dispose();
  }
}
