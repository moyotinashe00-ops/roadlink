import 'package:geolocator/geolocator.dart';

class LocationServiceException implements Exception {
  final String message;
  LocationServiceException(this.message);
  @override
  String toString() => message;
}

/// Wraps Geolocator to satisfy SRS requirement CIT-02: the app shall
/// automatically capture the device's GPS coordinates at the moment
/// of reporting, without requiring mobile data for the GPS fix itself.
class LocationService {
  Future<Position> getCurrentPosition() async {
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      throw LocationServiceException(
        'Location services are turned off. Enable GPS to report an accident.',
      );
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied) {
        throw LocationServiceException('Location permission was denied.');
      }
    }

    if (permission == LocationPermission.deniedForever) {
      throw LocationServiceException(
        'Location permission is permanently denied. Enable it in device settings.',
      );
    }

    return Geolocator.getCurrentPosition(
      desiredAccuracy: LocationAccuracy.high,
    );
  }
}
