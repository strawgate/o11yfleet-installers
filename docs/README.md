# Documentation Index

Use the smallest doc that answers the question.

| Need                             | Start here                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------- |
| Run the app locally              | [README](../README.md), then [dev loop](development/dev-loop.md)              |
| Build or change code             | [DEVELOPING](../DEVELOPING.md)                                                |
| Deploy or configure secrets      | [DEPLOY](../DEPLOY.md), then [Cloudflare setup](../infra/CLOUDFLARE_SETUP.md) |
| Understand system design         | [Architecture overview](architecture/overview.md)                             |
| Use consistent product language  | [Product model](product/model.md)                                             |
| Understand packaging and pricing | [Pricing model](product/pricing.md)                                           |
| Work on pipeline management      | [Pipeline management](product/pipeline-management.md)                         |
| Work on AI guidance              | [AI guidance](product/ai-guidance.md)                                         |
| Debug WebSocket/load behavior    | [Cloudflare WebSocket scaling](operations/cloudflare-websocket-scaling.md)    |
| Review historical design context | [Portal design notes](research/portal-design-notes.md)                        |

## Doc Rules

- Root docs are entry points: user quick start, developer workflow, deployment,
  agent instructions, and subjective style.
- `docs/architecture/` describes how the system is built.
- `docs/product/` defines product language and planned behavior.
- `docs/operations/` keeps troubleshooting and operational evidence.
- `docs/research/` keeps condensed historical context only when it still informs
  current work.
