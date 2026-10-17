import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Neutrals + status colours shared by every RoadLink app. The per-app accent
/// (police blue, ambulance red) comes from [AppTheme.dark] and is read back
/// through `Theme.of(context).colorScheme.primary`.
class AppColors {
  AppColors._();
  static const Color bg = Color(0xFF0D0A0F);
  static const Color surface = Color(0xFF17121B);
  static const Color surfaceAlt = Color(0xFF211A27);
  static const Color border = Color(0xFF372C3E);
  static const Color alert = Color(0xFFFF4B1F);
  static const Color amber = Color(0xFFFFC21A);
  static const Color safe = Color(0xFF46E08F);
  static const Color lime = Color(0xFFD7FF3A); // hi-vis brand accent
  static const Color textPrimary = Color(0xFFF5EEE3);
  static const Color textMuted = Color(0xFFA79B9D);
}

/// Typography helpers. The display face is Big Shoulders Display, a condensed road-sign style that
/// matches the dashboard. If that family is ever missing from the installed google_fonts version we
/// fall back to Rajdhani, so a font problem can never crash the app.
class RoadLinkFonts {
  RoadLinkFonts._();

  /// Big Shoulders runs narrow, so it is scaled up slightly to keep the same visual size as before.
  static const double _displayScale = 1.12;

  static TextStyle display({
    double? fontSize,
    FontWeight? fontWeight,
    double? letterSpacing,
    Color? color,
    double? height,
  }) {
    try {
      return GoogleFonts.getFont(
        'Big Shoulders Display',
        fontSize: fontSize == null ? null : fontSize * _displayScale,
        fontWeight: fontWeight,
        letterSpacing: letterSpacing,
        color: color,
        height: height,
      );
    } catch (_) {
      return GoogleFonts.rajdhani(
        fontSize: fontSize,
        fontWeight: fontWeight,
        letterSpacing: letterSpacing,
        color: color,
        height: height,
      );
    }
  }
}

class AppTheme {
  AppTheme._();

  static ThemeData dark({required Color accent}) {
    final base = GoogleFonts.ibmPlexSansTextTheme(ThemeData.dark().textTheme);
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      scaffoldBackgroundColor: AppColors.bg,
      colorScheme: ColorScheme.dark(
        primary: accent,
        secondary: AppColors.lime,
        surface: AppColors.surface,
        error: AppColors.alert,
      ),
      textTheme: base.copyWith(
        displayLarge: RoadLinkFonts.display(fontSize: 34, fontWeight: FontWeight.w800, letterSpacing: 1.4, color: AppColors.textPrimary),
        headlineMedium: RoadLinkFonts.display(fontSize: 24, fontWeight: FontWeight.w700, letterSpacing: 0.8, color: AppColors.textPrimary),
        titleLarge: RoadLinkFonts.display(fontSize: 20, fontWeight: FontWeight.w700, color: AppColors.textPrimary),
        bodyLarge: GoogleFonts.ibmPlexSans(fontSize: 16, color: AppColors.textPrimary),
        bodyMedium: GoogleFonts.ibmPlexSans(fontSize: 14, color: AppColors.textMuted),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: Colors.transparent,
        elevation: 0,
        centerTitle: false,
        titleTextStyle: RoadLinkFonts.display(fontSize: 20, fontWeight: FontWeight.w700, letterSpacing: 2, color: AppColors.textPrimary),
        iconTheme: const IconThemeData(color: AppColors.textPrimary),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: accent,
          foregroundColor: Colors.white,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.lime,
          side: const BorderSide(color: AppColors.lime),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.surface,
        contentPadding: const EdgeInsets.all(14),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: AppColors.border)),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: AppColors.border)),
        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide(color: accent, width: 1.6)),
        hintStyle: GoogleFonts.ibmPlexSans(color: AppColors.textMuted),
      ),
      dividerColor: AppColors.border,
    );
  }
}
