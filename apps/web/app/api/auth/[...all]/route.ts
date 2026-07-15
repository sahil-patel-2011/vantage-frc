import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@vantage/core";

export const { GET, POST } = toNextJsHandler(auth);
