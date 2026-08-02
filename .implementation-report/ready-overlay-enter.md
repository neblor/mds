# Ready Overlay Enter Support

## Request

Allow the `Let's Go!` ready screen to start dictation with Enter.

## Implementation

- The `Let's Go!` button receives focus when the ready overlay mounts.
- A first Enter key press starts dictation; keyboard auto-repeat is ignored.
- Added unit coverage for the keyboard activation rule.

## Verification

- `pnpm test:run -- src/lib/ready-overlay.test.ts`
