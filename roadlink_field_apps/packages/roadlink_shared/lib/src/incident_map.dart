import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import 'field_controller.dart';
import 'theme.dart';

class MapPin {
  final LatLng point;
  final Color color;
  final IconData icon;
  const MapPin(this.point, this.color, this.icon);
}

/// Map showing the scene, optionally the hospital, and the user's own position.
/// Uses OpenStreetMap tiles so it needs no API key — fine for development; use a commercial or
/// self-hosted tile provider for production load (OSM's public servers have a usage policy).
class IncidentMap extends StatelessWidget {
  final List<MapPin> pins;
  final LatLng? me;
  final String userAgentPackage;
  final double height;

  const IncidentMap({super.key, required this.pins, required this.userAgentPackage, this.me, this.height = 230});

  @override
  Widget build(BuildContext context) {
    final points = [...pins.map((p) => p.point), if (me != null) me!];
    final spread = points.length > 1 && points.any((p) => p.latitude != points.first.latitude || p.longitude != points.first.longitude);

    return SizedBox(
      height: height,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: FlutterMap(
          options: MapOptions(
            initialCenter: points.first,
            initialZoom: 15,
            initialCameraFit: spread
                ? CameraFit.bounds(bounds: LatLngBounds.fromPoints(points), padding: const EdgeInsets.all(44), maxZoom: 16)
                : null,
          ),
          children: [
            TileLayer(
              urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              userAgentPackageName: userAgentPackage,
              tileBuilder: darkModeTileBuilder,
            ),
            MarkerLayer(
              markers: [
                for (final p in pins)
                  Marker(point: p.point, width: 44, height: 44, child: Icon(p.icon, color: p.color, size: 40)),
                if (me != null)
                  Marker(
                    point: me!,
                    width: 26,
                    height: 26,
                    child: Container(
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: const Color(0xFF3AA0FF),
                        border: Border.all(color: Colors.white, width: 3),
                        boxShadow: const [BoxShadow(color: Color(0xFF3AA0FF), blurRadius: 12)],
                      ),
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Convenience pin colours.
class Pins {
  Pins._();
  static MapPin scene(double lat, double lng) => MapPin(LatLng(lat, lng), AppColors.alert, Icons.location_on);
  static MapPin hospital(double lat, double lng) => MapPin(LatLng(lat, lng), AppColors.safe, Icons.local_hospital);
}

/// [IncidentMap] that follows the device's live position without rebuilding the whole screen.
class LiveIncidentMap extends StatelessWidget {
  final FieldController controller;
  final List<MapPin> pins;
  final String userAgentPackage;
  final double height;
  const LiveIncidentMap({super.key, required this.controller, required this.pins, required this.userAgentPackage, this.height = 230});

  @override
  Widget build(BuildContext context) {
    final loc = controller.location;
    if (loc == null) {
      return IncidentMap(pins: pins, userAgentPackage: userAgentPackage, height: height);
    }
    return ValueListenableBuilder<LatLng?>(
      valueListenable: loc.position,
      builder: (_, me, __) => IncidentMap(pins: pins, me: me, userAgentPackage: userAgentPackage, height: height),
    );
  }
}
