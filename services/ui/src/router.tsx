import {
  createRouter,
  createRoute,
  createRootRoute,
  redirect,
} from "@tanstack/react-router";
import { Layout } from "./components/Layout";
import { UploadPage } from "./routes/UploadPage";
import { RankPage } from "./routes/RankPage";

const rootRoute = createRootRoute({ component: Layout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/upload" });
  },
});

const uploadRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/upload",
  component: UploadPage,
});

const rankRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/rank",
  component: RankPage,
});

const routeTree = rootRoute.addChildren([indexRoute, uploadRoute, rankRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
