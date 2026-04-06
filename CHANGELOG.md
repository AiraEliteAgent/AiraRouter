# Changelog

## [Unreleased]

## [3.5.2] - 2026-04-07

### Added

- **Beeknoee AI Provider**: Added full integration with multi-key support
  - Models: GPT-4o, GPT-4o Mini, Claude 3.5 Sonnet, Claude 3.5 Haiku, Gemini 2.0 Flash, Gemini Exp 1206
  - OpenAI-compatible format with Bearer token auth
  - Provider logo and configuration

### Improved

- **Dashboard Responsive Design**: Enhanced mobile experience across the dashboard
  - Header: Responsive padding (`px-4 sm:px-6 lg:px-8`), title sizing (`text-lg sm:text-xl lg:text-2xl`)
  - Page titles now visible on mobile (removed `hidden lg:flex`)
  - Language selector hidden on mobile, badges hidden on small screens
  - Media page: Improved modality tabs, form padding, and info cards grid for mobile

### Changed

- Updated provider registry with Beeknoee AI configuration
- Enhanced mobile UI components for better usability on small screens
