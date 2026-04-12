# @sweefi/hono

## 0.1.1

### Patch Changes

- Set hosted SweeFi facilitator (https://swee-facilitator.fly.dev) as the default `facilitatorUrl`. Previously an empty string, requiring all callers to configure their own facilitator. Agents using `createS402Client()` without an explicit `facilitatorUrl` now route through the hosted facilitator automatically.
