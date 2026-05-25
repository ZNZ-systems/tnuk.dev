# Contributing

Thanks for helping improve thermo-review.

## Development setup

```bash
git clone https://github.com/pzep1/thermo-review-cli.git
cd thermo-review-cli
npm install
npm run build
npm link
```

## Making changes

1. Edit TypeScript under `src/`
2. Run `npm run build`
3. Test manually:

   ```bash
   thermo-review review --help
   thermo-review review   # in a git repo with CURSOR_API_KEY set
   ```

## Pull requests

- Keep diffs focused
- Update README if CLI flags or behavior change
- Do not commit secrets or `.env` files

## Reporting issues

Include:

- OS and Node version (`node -v`)
- Output of `thermo-review --version`
- Whether hook install ran automatically or you used `hook install` manually
- Redacted error output (never paste API keys)
