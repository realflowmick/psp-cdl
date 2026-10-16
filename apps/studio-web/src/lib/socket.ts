// SPDX-License-Identifier: Apache-2.0
import { io, type Socket } from "socket.io-client";
import { SOCKET_PATH } from "./stream";

let shared: Socket | undefined;
/** One socket per page; reconnects are automatic and subscriptions re-request from their last seq. */
export function studioSocket(): Socket {
  if (!shared) shared = io({ path: SOCKET_PATH, transports: ["websocket", "polling"] });
  return shared;
}