import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("api/upload", "routes/api.upload.ts"),
  route("api/separate", "routes/api.separate.ts"),
  route("api/status/:taskId", "routes/api.status.$taskId.ts"),
  route("api/stems/:taskId", "routes/api.stems.$taskId.ts"),
  route("api/webhook", "routes/api.webhook.ts"),
] satisfies RouteConfig;
