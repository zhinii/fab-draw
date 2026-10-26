Skeleton tracing is vendored from Lingdong Huang's MIT-licensed implementation:
https://github.com/LingDong-/skeleton-tracing

Pinned upstream commit: f5dd65e2389f9311dd3c24b9a83bd852c28c49e9
Source: js/trace_skeleton.vanilla.js (renamed to skeleton-tracing.mjs).
License: skeleton-tracing.LICENSE.

No runtime CDN requests are used.

Local correction: thinning continues while either subpass changes pixels.
Fab Draw uses the thinning function and walks the resulting pixel graph in
trace-core.mjs, preserving exact endpoints instead of approximate chunk centres.
