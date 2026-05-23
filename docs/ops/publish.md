# Publishing tnuk to npm

Package name: `tnuk` (verified available on npm registry).

## Prerequisites

- npm account with publish access
- `NPM_TOKEN` secret in GitHub for CI (see `.github/workflows/release.yml`)

## Manual publish

```bash
npm login
npm run test
npm publish --access public
```

## Tag release (CI)

```bash
git tag v0.2.0
git push origin v0.2.0
```

## Deprecate old package (if `thermo-review-cli` was published)

```bash
npm deprecate thermo-review-cli "Renamed to tnuk — npm install -g tnuk"
```
