import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Neutrals + status colours shared by every RoadLink app. The per-app accent
/// (police blue, ambulance red) comes from [AppTheme.dark] and is read back
/// through `Theme.of(context).colorScheme.primary`.
class AppColors {
  AppColors._();
  static const Color bg = Color(0xFF0A0A0F);
  static const Color surface = Color(0xFF15151F);
  static const Color surfaceAlt = Color(0xFF1D1D2A);
  static const Color border = Color(0xFF2A2A38);
  static const Color alert = Color(0xFFFF2E43);
  static const Color amber = Color(0xFFFFB020);
  static const Color safe = Color(0xFF34D399);
  static const Color textPrimary = Color(0xFFF3F3F7);
  static const Color textMuted = Color(0xFF8C8C9C);
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
        secondary: AppColors.amber,
        surface: AppColors.surface,
        error: AppColors.alert,
      ),
      textTheme: base.copyWith(
        displayLarge: GoogleFonts.rajdhani(fontSize: 34, fontWeight: FontWeight.w800, letterSpacing: 1.4, color: AppColors.textPrimary),
        headlineMedium: GoogleFonts.rajdhani(fontSize: 24, fontWeight: FontWeight.w700, letterSpacing: 0.8, color: AppColors.textPrimary),
        titleLarge: GoogleFonts.rajdhani(fontSize: 20, fontWeight: FontWeight.w700, color: AppColors.textPrimary),
        bodyLarge: GoogleFonts.ibmPlexSans(fontSize: 16, color: AppColors.textPrimary),
        bodyMedium: GoogleFonts.ibmPlexSans(fontSize: 14, color: AppColors.textMuted),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: Colors.transparent,
        elevation: 0,
        centerTitle: false,
        titleTextStyle: GoogleFonts.rajdhani(fontSize: 20, fontWeight: FontWeight.w700, letterSpacing: 2, color: AppColors.textPrimary),
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
          foregroundColor: AppColors.amber,
          side: const BorderSide(color: AppColors.amber),
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
