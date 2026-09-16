# Changelog

## 5.0.0

- Require cf-genai-base 5.
- Add explicit durable generation through `generateJob`.
- Report generation progress through base job events.
- Keep model output out of durable job records unless the application supplies a compact result mapper.
