# Tradeit

A private, single-user research system that gathers financial information from many
independent sources, compresses it into a weekly evidence packet, has Claude form
and then attack an opinion on it, and produces a ranked list of candidate trades
with pre-defined size, stop, and exit date.

**Tradeit does not execute trades.** It produces a brief. Pete reads it, decides,
and places every order himself. Every number in the brief traces back to a source
row with a timestamp and a URL.

- Plan: [`docs/PLAN.md`](docs/PLAN.md)
- Owner/operator: Pete Gombert (sole user)
- Deployment: `trade.meadowlark.*`, GCP project `meadowlark-492419`
- Instruments: stocks and ETFs only, in a Schwab retirement account

## Status

Planning. No code yet — see `docs/PLAN.md` Phase 0 for the first build step.
