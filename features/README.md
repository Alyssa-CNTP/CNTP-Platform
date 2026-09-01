# features/

Self-contained feature modules. See ARCHITECTURE.md §2 and §3.

Each feature is one folder. Everything inside it is private except `index.ts`,
which is its only public surface — other code imports the feature through that
and nothing else.

    features/
    └── supervisor-adjustments/
        ├── components/
        ├── actions.ts
        └── index.ts        <- the only thing anyone outside imports

Rules, enforced by `npm run lint:boundaries`:

- A feature may import from `lib/core/**`. `lib/core` may **not** import from here.
- A feature may not deep-import another feature's internals.

Mount a feature behind a flag in `lib/config/flags.ts`, wrapped in
`<FeatureBoundary>`, so a crash in it cannot take down the page around it:

    {flags.myFeature && (
      <FeatureBoundary name="My feature">
        <MyFeature />
      </FeatureBoundary>
    )}
