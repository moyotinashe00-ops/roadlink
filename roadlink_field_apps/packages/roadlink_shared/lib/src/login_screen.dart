import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'api_client.dart';
import 'field_controller.dart';
import 'theme.dart';
import 'widgets.dart';

class LoginScreen extends StatefulWidget {
  final FieldController controller;
  final String title;
  final String subtitle;
  final IconData icon;
  const LoginScreen({super.key, required this.controller, required this.title, required this.subtitle, required this.icon});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _id = TextEditingController();
  final _pw = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _id.dispose();
    _pw.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.controller.signIn(_id.text.trim(), _pw.text);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final accent = Theme.of(context).colorScheme.primary;
    final message = _error ?? widget.controller.notice;
    return Scaffold(
      body: HudBackground(
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(28),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 68,
                      height: 68,
                      decoration: BoxDecoration(
                        borderRadius: const BorderRadius.only(
                            topLeft: Radius.circular(22), bottomRight: Radius.circular(22), topRight: Radius.circular(6), bottomLeft: Radius.circular(6)),
                        gradient: LinearGradient(colors: [accent, accent.withValues(alpha: 0.55)]),
                        boxShadow: [BoxShadow(color: accent.withValues(alpha: 0.5), blurRadius: 28)],
                      ),
                      child: Icon(widget.icon, color: Colors.white, size: 36),
                    ),
                    const SizedBox(height: 22),
                    Text('ROADLINK', style: Theme.of(context).textTheme.displayLarge),
                    Text(widget.title.toUpperCase(),
                        style: GoogleFonts.rajdhani(fontSize: 16, letterSpacing: 6, color: AppColors.amber, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 6),
                    Text(widget.subtitle, style: Theme.of(context).textTheme.bodyMedium),
                    const SizedBox(height: 28),
                    TextField(
                      controller: _id,
                      keyboardType: TextInputType.emailAddress,
                      autofillHints: const [AutofillHints.username],
                      decoration: const InputDecoration(labelText: 'Email or phone'),
                    ),
                    const SizedBox(height: 14),
                    TextField(
                      controller: _pw,
                      obscureText: true,
                      autofillHints: const [AutofillHints.password],
                      onSubmitted: (_) => _submit(),
                      decoration: const InputDecoration(labelText: 'Password'),
                    ),
                    if (message != null) ...[
                      const SizedBox(height: 14),
                      Text(message, style: GoogleFonts.ibmPlexSans(color: AppColors.alert)),
                    ],
                    const SizedBox(height: 22),
                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton(
                        onPressed: _busy ? null : _submit,
                        style: ElevatedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 18)),
                        child: _busy
                            ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white))
                            : Text('SIGN IN', style: GoogleFonts.rajdhani(fontSize: 18, fontWeight: FontWeight.w800, letterSpacing: 2, color: Colors.white)),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
