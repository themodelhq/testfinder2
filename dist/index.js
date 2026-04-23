var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

// server/_core/index.ts
import "dotenv/config";
import express2 from "express";
import cors from "cors";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// shared/const.ts
var COOKIE_NAME = "app_session_id";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var AXIOS_TIMEOUT_MS = 3e4;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";

// server/db.ts
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";

// drizzle/schema.ts
import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, json, boolean, decimal } from "drizzle-orm/mysql-core";
var users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull()
});
var products = mysqlTable("products", {
  id: int("id").autoincrement().primaryKey(),
  sku: varchar("sku", { length: 255 }).notNull().unique(),
  name: text("name"),
  brand: varchar("brand", { length: 255 }),
  category: text("category"),
  price: decimal("price", { precision: 12, scale: 2 }),
  oldPrice: decimal("oldPrice", { precision: 12, scale: 2 }),
  discount: varchar("discount", { length: 50 }),
  rating: decimal("rating", { precision: 3, scale: 2 }),
  totalRatings: int("totalRatings"),
  image: text("image"),
  url: text("url"),
  seller: varchar("seller", { length: 255 }),
  isJumiaExpress: boolean("isJumiaExpress").default(false),
  isShopGlobal: boolean("isShopGlobal").default(false),
  stock: varchar("stock", { length: 50 }),
  tags: json("tags"),
  country: varchar("country", { length: 10 }).default("NG"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});
var searches = mysqlTable("searches", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  query: text("query"),
  country: varchar("country", { length: 10 }).default("NG"),
  resultsCount: int("resultsCount").default(0),
  filters: json("filters"),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});

// server/_core/env.ts
var ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // Webshare.io rotating residential proxy (required on Render — Jumia blocks Render IPs)
  // Set these in Render → Environment Variables
  webshareProxyUsername: process.env.WEBSHARE_PROXY_USERNAME ?? "",
  webshareProxyPassword: process.env.WEBSHARE_PROXY_PASSWORD ?? "",
  webshareProxyHost: process.env.WEBSHARE_PROXY_HOST ?? "p.webshare.io",
  webshareProxyPort: process.env.WEBSHARE_PROXY_PORT ?? "80"
};

// server/db.ts
var _db = null;
async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}
async function upsertUser(user) {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }
  try {
    const values = {
      openId: user.openId
    };
    const updateSet = {};
    const textFields = ["name", "email", "loginMethod"];
    const assignNullable = (field) => {
      const value = user[field];
      if (value === void 0) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== void 0) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== void 0) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }
    if (!values.lastSignedIn) {
      values.lastSignedIn = /* @__PURE__ */ new Date();
    }
    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = /* @__PURE__ */ new Date();
    }
    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}
async function getUserByOpenId(openId) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return void 0;
  }
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}

// server/_core/cookies.ts
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}
function getSessionCookieOptions(req) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: isSecureRequest(req)
  };
}

// shared/_core/errors.ts
var HttpError = class extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HttpError";
  }
};
var ForbiddenError = (msg) => new HttpError(403, msg);

// server/_core/sdk.ts
import axios from "axios";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
var isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
var EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
var GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
var GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;
var OAuthService = class {
  constructor(client) {
    this.client = client;
    console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    if (!ENV.oAuthServerUrl) {
      console.error(
        "[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable."
      );
    }
  }
  decodeState(state) {
    const redirectUri = atob(state);
    return redirectUri;
  }
  async getTokenByCode(code, state) {
    const payload = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state)
    };
    const { data } = await this.client.post(
      EXCHANGE_TOKEN_PATH,
      payload
    );
    return data;
  }
  async getUserInfoByToken(token) {
    const { data } = await this.client.post(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken
      }
    );
    return data;
  }
};
var createOAuthHttpClient = () => axios.create({
  baseURL: ENV.oAuthServerUrl,
  timeout: AXIOS_TIMEOUT_MS
});
var SDKServer = class {
  client;
  oauthService;
  constructor(client = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }
  deriveLoginMethod(platforms, fallback) {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set(
      platforms.filter((p) => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (set.has("REGISTERED_PLATFORM_MICROSOFT") || set.has("REGISTERED_PLATFORM_AZURE"))
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }
  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(code, state) {
    return this.oauthService.getTokenByCode(code, state);
  }
  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken) {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken
    });
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  parseCookies(cookieHeader) {
    if (!cookieHeader) {
      return /* @__PURE__ */ new Map();
    }
    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }
  getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }
  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(openId, options = {}) {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || ""
      },
      options
    );
  }
  async signSession(payload, options = {}) {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
    const secretKey = this.getSessionSecret();
    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expirationSeconds).sign(secretKey);
  }
  async verifySession(cookieValue) {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }
    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"]
      });
      const { openId, appId, name } = payload;
      if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || !isNonEmptyString(name)) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }
      return {
        openId,
        appId,
        name
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }
  async getUserInfoWithJwt(jwtToken) {
    const payload = {
      jwtToken,
      projectId: ENV.appId
    };
    const { data } = await this.client.post(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  async authenticateRequest(req) {
    const cookies = this.parseCookies(req.headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await this.verifySession(sessionCookie);
    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }
    const sessionUserId = session.openId;
    const signedInAt = /* @__PURE__ */ new Date();
    let user = await getUserByOpenId(sessionUserId);
    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionCookie ?? "");
        await upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt
        });
        user = await getUserByOpenId(userInfo.openId);
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }
    if (!user) {
      throw ForbiddenError("User not found");
    }
    await upsertUser({
      openId: user.openId,
      lastSignedIn: signedInAt
    });
    return user;
  }
};
var sdk = new SDKServer();

// server/_core/oauth.ts
function getQueryParam(req, key) {
  const value = req.query[key];
  return typeof value === "string" ? value : void 0;
}
function registerOAuthRoutes(app) {
  app.get("/api/oauth/callback", async (req, res) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }
    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }
      await upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: /* @__PURE__ */ new Date()
      });
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      const redirectUrl = process.env.FRONTEND_URL || "/";
      res.redirect(302, redirectUrl);
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}

// server/_core/chat.ts
import { streamText, stepCountIs } from "ai";
import { tool } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod/v4";

// server/_core/patchedFetch.ts
function createPatchedFetch(originalFetch) {
  return async (input, init) => {
    const response = await originalFetch(input, init);
    if (!response.body) return response;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";
    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            if (buffer.length > 0) {
              const fixed = buffer.replace(/"type":""/g, '"type":"function"');
              controller.enqueue(encoder.encode(fixed));
            }
            controller.close();
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          const eventSeparator = "\n\n";
          let separatorIndex;
          while ((separatorIndex = buffer.indexOf(eventSeparator)) !== -1) {
            const completeEvent = buffer.slice(
              0,
              separatorIndex + eventSeparator.length
            );
            buffer = buffer.slice(separatorIndex + eventSeparator.length);
            const fixedEvent = completeEvent.replace(
              /"type":""/g,
              '"type":"function"'
            );
            controller.enqueue(encoder.encode(fixedEvent));
          }
        } catch (error) {
          controller.error(error);
        }
      }
    });
    return new Response(stream, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText
    });
  };
}

// server/_core/chat.ts
function createLLMProvider() {
  const baseURL = ENV.forgeApiUrl.endsWith("/v1") ? ENV.forgeApiUrl : `${ENV.forgeApiUrl}/v1`;
  return createOpenAI({
    baseURL,
    apiKey: ENV.forgeApiKey,
    fetch: createPatchedFetch(fetch)
  });
}
var tools = {
  getWeather: tool({
    description: "Get the current weather for a location",
    inputSchema: z.object({
      location: z.string().describe("The city and country, e.g. 'Tokyo, Japan'"),
      unit: z.enum(["celsius", "fahrenheit"]).optional().default("celsius")
    }),
    execute: async ({ location, unit }) => {
      const temp = Math.floor(Math.random() * 30) + 5;
      const conditions = ["sunny", "cloudy", "rainy", "partly cloudy"][Math.floor(Math.random() * 4)];
      return {
        location,
        temperature: unit === "fahrenheit" ? Math.round(temp * 1.8 + 32) : temp,
        unit,
        conditions,
        humidity: Math.floor(Math.random() * 50) + 30
      };
    }
  }),
  calculate: tool({
    description: "Perform a mathematical calculation",
    inputSchema: z.object({
      expression: z.string().describe("The math expression to evaluate, e.g. '2 + 2'")
    }),
    execute: async ({ expression }) => {
      try {
        const sanitized = expression.replace(/[^0-9+\-*/().%\s]/g, "");
        const result = Function(
          `"use strict"; return (${sanitized})`
        )();
        return { expression, result };
      } catch {
        return { expression, error: "Invalid expression" };
      }
    }
  })
};
function registerChatRoutes(app) {
  const openai = createLLMProvider();
  app.post("/api/chat", async (req, res) => {
    try {
      const { messages } = req.body;
      if (!messages || !Array.isArray(messages)) {
        res.status(400).json({ error: "messages array is required" });
        return;
      }
      const result = streamText({
        model: openai.chat("gpt-4o"),
        system: "You are a helpful assistant. You have access to tools for getting weather and doing calculations. Use them when appropriate.",
        messages,
        tools,
        stopWhen: stepCountIs(5)
      });
      result.pipeUIMessageStreamToResponse(res);
    } catch (error) {
      console.error("[/api/chat] Error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });
}

// server/_core/systemRouter.ts
import { z as z2 } from "zod";

// server/_core/notification.ts
import { TRPCError } from "@trpc/server";
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString2 = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString2(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString2(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/trpc.ts
import { initTRPC, TRPCError as TRPCError2 } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError2({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z2.object({
      timestamp: z2.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  notifyOwner: adminProcedure.input(
    z2.object({
      title: z2.string().min(1, "title is required"),
      content: z2.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// server/routers.ts
import { z as z3 } from "zod";

// server/jumia-scraper.ts
import { load } from "cheerio";

// server/webshare-proxy.ts
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
var _proxyConfig = void 0;
function getProxyConfig() {
  if (_proxyConfig !== void 0) return _proxyConfig;
  const username = process.env.WEBSHARE_PROXY_USERNAME;
  const password = process.env.WEBSHARE_PROXY_PASSWORD;
  if (!username || !password) {
    console.warn("[Proxy] WEBSHARE_PROXY_USERNAME / WEBSHARE_PROXY_PASSWORD not set \u2014 direct connection will be used.");
    _proxyConfig = null;
    return null;
  }
  const host = process.env.WEBSHARE_PROXY_HOST ?? "p.webshare.io";
  const port = process.env.WEBSHARE_PROXY_PORT ?? "80";
  const proxyUrl = `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
  _proxyConfig = {
    proxyUrl,
    httpAgent: new HttpProxyAgent(proxyUrl),
    httpsAgent: new HttpsProxyAgent(proxyUrl)
  };
  console.log(`[Proxy] Webshare proxy configured \u2192 ${host}:${port}`);
  return _proxyConfig;
}
function proxyFetchOptions() {
  const cfg = getProxyConfig();
  if (!cfg) return {};
  return {
    agent: cfg.httpsAgent,
    // node-fetch compat
    // dispatcher is undici-specific; only attach if undici is available
    ...getDispatcherOption(cfg.proxyUrl)
  };
}
function getDispatcherOption(proxyUrl) {
  try {
    const { ProxyAgent } = __require("undici");
    return { dispatcher: new ProxyAgent(proxyUrl) };
  } catch {
    return {};
  }
}

// server/jumia-scraper.ts
var USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15"
];
var JUMIA_DOMAINS = {
  NG: "https://www.jumia.com.ng",
  KE: "https://www.jumia.co.ke",
  UG: "https://www.jumia.ug",
  EG: "https://www.jumia.com.eg",
  GH: "https://www.jumia.com.gh",
  CI: "https://www.jumia.ci",
  MA: "https://www.jumia.ma",
  TN: "https://www.jumia.com.tn",
  ZA: "https://www.zando.co.za",
  SN: "https://www.jumia.sn",
  DZ: "https://www.jumia.com.dz",
  IC: "https://www.jumia.is"
};
function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}
async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function extractStoreData(html) {
  const marker = "window.__STORE__=";
  const markerAlt = "window.__STORE__ =";
  let markerIdx = html.indexOf(marker);
  if (markerIdx === -1) markerIdx = html.indexOf(markerAlt);
  if (markerIdx === -1) return null;
  const jsonStart = html.indexOf("{", markerIdx);
  if (jsonStart === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  let jsonEnd = -1;
  for (let i = jsonStart; i < html.length; i++) {
    const ch = html[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        jsonEnd = i;
        break;
      }
    }
  }
  if (jsonEnd === -1) return null;
  try {
    return JSON.parse(html.slice(jsonStart, jsonEnd + 1));
  } catch {
    const m = html.match(/window\.__STORE__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
    if (m) {
      try {
        return JSON.parse(m[1]);
      } catch {
      }
    }
    return null;
  }
}
async function fetchSellerFromProductPage(productUrl) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15e3);
    const response = await fetch(productUrl, {
      method: "GET",
      headers: {
        "User-Agent": getRandomUserAgent(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate",
        "DNT": "1",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Cache-Control": "max-age=0"
      },
      signal: controller.signal,
      ...proxyFetchOptions()
    });
    clearTimeout(timeoutId);
    if (!response.ok) return null;
    const html = await response.text();
    const JUNK = ["\u0627\u0644\u0639\u0631\u0628\u064A\u0629", "Appliances", "Sign In", "Jumia"];
    const storeData = extractStoreData(html);
    if (storeData) {
      const candidates = [
        storeData.viewData?.seller?.name,
        storeData.googleAds?.targeting?.seller?.[0],
        storeData.products?.[0]?.sellerEntity?.name,
        storeData.products?.[0]?.sellerName,
        storeData.product?.sellerEntity?.name,
        storeData.product?.sellerName
      ];
      for (const c of candidates) {
        if (c && !JUNK.includes(c)) return c;
      }
    }
    const $ = load(html);
    const sellerText = $('[data-qa="seller-name"], .-plxs.-pbxs .-b, .sold-by a, .-seller a').first().text().trim();
    if (sellerText && !JUNK.includes(sellerText) && sellerText.length > 1) return sellerText;
    const sellerSection = $('h2:contains("Seller Information"), h2:contains("Informations sur le vendeur")').closest(".card, section");
    if (sellerSection.length > 0) {
      const nameInLink = sellerSection.find('a[href*="/"]').first().text().trim();
      if (nameInLink && !JUNK.includes(nameInLink) && nameInLink.length > 2) return nameInLink;
    }
    const jsonLd = $('script[type="application/ld+json"]').html();
    if (jsonLd) {
      try {
        const data = JSON.parse(jsonLd);
        if (data.seller?.name && !JUNK.includes(data.seller.name)) return data.seller.name;
      } catch {
      }
    }
    return null;
  } catch (error) {
    console.error(`[Jumia Scraper] Error fetching seller from ${productUrl}:`, error);
    return null;
  }
}
async function fetchPage(url, timeout = 3e4) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": getRandomUserAgent(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate",
        "DNT": "1",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Cache-Control": "max-age=0"
      },
      signal: controller.signal,
      ...proxyFetchOptions()
    });
    clearTimeout(timeoutId);
    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}
async function fetchJumiaByUrl(url, options = {}) {
  const delayMs = options.delay ?? Math.random() * 2e3 + 1e3;
  const timeout = options.timeout ?? 3e4;
  await delay(delayMs);
  let country = options.country ?? "NG";
  for (const [code, domain] of Object.entries(JUMIA_DOMAINS)) {
    if (url.startsWith(domain)) {
      country = code;
      break;
    }
  }
  const proxied = !!(process.env.WEBSHARE_PROXY_USERNAME && process.env.WEBSHARE_PROXY_PASSWORD);
  try {
    const response = await fetchPage(url, timeout);
    if (!response.ok) {
      if (response.status === 403 || response.status === 429) {
        console.warn(`[Jumia Scraper] Rate limited (${response.status}). Returning empty.`);
        return { products: [], hasMore: false, debug: { httpStatus: response.status, proxied, url } };
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const html = await response.text();
    const responseBytes = html.length;
    const looksBlocked = responseBytes < 5e3 || /access denied|captcha|are you a human|px-captcha|just a moment|cf-challenge/i.test(html.slice(0, 2e4));
    const storeData = (() => {
      const marker = "window.__STORE__=";
      const markerAlt = "window.__STORE__ =";
      return html.includes(marker) || html.includes(markerAlt);
    })();
    const products2 = looksBlocked ? [] : await extractProductsFromHTML(html, country);
    const hasMore = (html.includes('rel="next"') || html.includes("rel='next'")) && products2.length > 0;
    const debug = {
      httpStatus: response.status,
      responseBytes,
      storeBlockFound: storeData,
      looksBlocked,
      proxied,
      url
    };
    if (looksBlocked) {
      console.warn(`[Jumia Scraper] Response looks like a challenge page (${responseBytes} bytes)`);
    }
    return { products: products2, hasMore, debug };
  } catch (error) {
    console.error(`[Jumia Scraper] Error fetching ${url}:`, error);
    return { products: [], hasMore: false, debug: { error: String(error), proxied, url } };
  }
}
async function fetchJumiaPage(query, page = 1, options = {}) {
  const country = options.country ?? "NG";
  const domain = JUMIA_DOMAINS[country] ?? JUMIA_DOMAINS.NG;
  const catalogUrl = `${domain}/catalog/?q=${encodeURIComponent(query)}&page=${page}#catalog-listing`;
  return fetchJumiaByUrl(catalogUrl, options);
}
async function fetchProductsBySkuList(skus, options = {}) {
  const country = options.country ?? "NG";
  const domain = JUMIA_DOMAINS[country] ?? JUMIA_DOMAINS.NG;
  const products2 = [];
  for (const sku of skus) {
    try {
      const searchUrl = `${domain}/catalog/?q=${encodeURIComponent(sku)}#catalog-listing`;
      const { products: found } = await fetchJumiaByUrl(searchUrl, { ...options, delay: 500 });
      if (found.length > 0) {
        const exact = found.find((p) => p.sku === sku);
        products2.push(exact ?? found[0]);
      }
    } catch (error) {
      console.error(`[Jumia Scraper] Error fetching SKU ${sku}:`, error);
    }
  }
  return products2;
}
async function extractProductsFromHTML(html, country) {
  try {
    const storeData = extractStoreData(html);
    if (storeData?.products && Array.isArray(storeData.products) && storeData.products.length > 0) {
      const results = [];
      const needsSeller = [];
      for (const product of storeData.products) {
        const extracted = buildProductFromStore(product, country, storeData);
        if (extracted) {
          if (!extracted.seller || extracted.seller === "Jumia") needsSeller.push(results.length);
          results.push(extracted);
        }
      }
      if (needsSeller.length > 0) {
        const CONCURRENCY = 8;
        const JUNK = ["\u0627\u0644\u0639\u0631\u0628\u064A\u0629", "Appliances", "Sign In"];
        for (let i = 0; i < needsSeller.length; i += CONCURRENCY) {
          const batch = needsSeller.slice(i, i + CONCURRENCY);
          const fetched = await Promise.all(
            batch.map(async (idx) => {
              const u = results[idx]?.url;
              if (!u) return "Jumia";
              try {
                const result = await Promise.race([
                  fetchSellerFromProductPage(u),
                  new Promise((r) => setTimeout(() => r(null), 8e3))
                ]);
                return result && !JUNK.includes(result) && result !== "Jumia" ? result : "Jumia";
              } catch {
                return "Jumia";
              }
            })
          );
          fetched.forEach((seller, j) => {
            const idx = batch[j];
            if (idx !== void 0 && results[idx]) results[idx].seller = seller;
          });
        }
      }
      return results;
    }
    console.warn("[Jumia Scraper] __STORE__ not found or empty \u2014 falling back to HTML parsing");
    return extractProductsCheerio(html, country);
  } catch (error) {
    console.error("[Jumia Scraper] Error parsing HTML:", error);
    return [];
  }
}
function buildProductFromStore(product, country, storeData) {
  if (!product.sku || !product.displayName) return null;
  const domain = JUMIA_DOMAINS[country] ?? JUMIA_DOMAINS.NG;
  const JUNK = ["\u0627\u0644\u0639\u0631\u0628\u064A\u0629", "Appliances", "Sign In"];
  let seller = !JUNK.includes(product.sellerEntity?.name) && product.sellerEntity?.name || !JUNK.includes(product.sellerName) && product.sellerName || !JUNK.includes(product.seller) && product.seller || !JUNK.includes(storeData?.googleAds?.targeting?.seller?.[0]) && storeData?.googleAds?.targeting?.seller?.[0] || "Jumia";
  if (JUNK.includes(seller)) seller = "Jumia";
  return {
    sku: product.sku,
    name: product.displayName || "",
    brand: product.brand || "Unknown",
    category: Array.isArray(product.categories) ? product.categories.join(" > ") : "",
    price: product.prices?.rawPrice ?? (product.prices?.price ? parseFloat(String(product.prices.price).replace(/[^0-9.]/g, "")) : 0),
    oldPrice: product.prices?.rawOldPrice ?? void 0,
    discount: product.prices?.discount ?? void 0,
    rating: product.rating?.average ?? 0,
    totalRatings: product.rating?.totalRatings ?? 0,
    image: product.image || "",
    url: product.url ? `${domain}${product.url}` : "",
    seller,
    isJumiaExpress: !!(product.isJumiaExpress || product.isShopExpress || product.shopExpress),
    isShopGlobal: !!product.isShopGlobal,
    stock: product.stockInfo?.text ?? "In Stock",
    tags: product.tags ? String(product.tags).split("|").filter(Boolean) : [],
    country
  };
}
function extractProductsCheerio(html, country) {
  const $ = load(html);
  const domain = JUMIA_DOMAINS[country] ?? JUMIA_DOMAINS.NG;
  const products2 = [];
  $("article.prd, article[data-sku], article.c-prd").each((_, el) => {
    const $el = $(el);
    const sku = $el.attr("data-sku") || $el.find("[data-sku]").first().attr("data-sku") || "";
    const anchor = $el.find("a.core, a[href]").first();
    const relUrl = anchor.attr("href") || "";
    const url = relUrl.startsWith("http") ? relUrl : relUrl ? `${domain}${relUrl}` : "";
    const name = $el.find('h3.name, h3[class*="name"], .info h3').first().text().trim() || $el.find("h3").first().text().trim();
    if (!name) return;
    const rawPrice = $el.find(".prc").first().text().replace(/[^0-9.]/g, "");
    const price = rawPrice ? parseFloat(rawPrice) : 0;
    const rawOld = $el.find(".old").first().text().replace(/[^0-9.]/g, "");
    const oldPrice = rawOld ? parseFloat(rawOld) : void 0;
    const discount = $el.find(".bdg._dsc, .-dsc").first().text().trim() || void 0;
    const starsClass = $el.find('[class*="_s"]').first().attr("class") || "";
    const starsMatch = starsClass.match(/_s(\d)/);
    const rating = starsMatch ? parseInt(starsMatch[1], 10) : 0;
    const ratingsText = $el.find(".rev span, .-rev span").first().text().replace(/[^0-9]/g, "");
    const totalRatings = ratingsText ? parseInt(ratingsText, 10) : 0;
    const imgEl = $el.find("img.img, img[data-src], img[src]").first();
    const image = imgEl.attr("data-src") || imgEl.attr("src") || "";
    const isJumiaExpress = $el.find('.bdg._expr, .-expr, [class*="express"]').length > 0;
    const isShopGlobal = $el.find('.bdg._glbl, [class*="global"]').length > 0;
    const isOutOfStock = $el.find('.-stockout, [class*="stockout"]').length > 0;
    if (!sku && !url) return;
    products2.push({
      sku,
      name,
      brand: $el.attr("data-brand") || "Unknown",
      category: "",
      price,
      oldPrice,
      discount,
      rating,
      totalRatings,
      image,
      url,
      seller: "Jumia",
      isJumiaExpress,
      isShopGlobal,
      stock: isOutOfStock ? "Out of Stock" : "In Stock",
      tags: [],
      country
    });
  });
  return products2;
}
function filterProducts(products2, filters) {
  return products2.filter((product) => {
    if (filters.brands?.length > 0 && !filters.brands.includes(product.brand)) return false;
    if (filters.sellers?.length > 0 && !filters.sellers.includes(product.seller)) return false;
    if (filters.minPrice !== void 0 && product.price < filters.minPrice) return false;
    if (filters.maxPrice !== void 0 && product.price > filters.maxPrice) return false;
    if (filters.minRating !== void 0 && (product.rating ?? 0) < filters.minRating) return false;
    if (filters.jumiaExpress !== void 0 && product.isJumiaExpress !== filters.jumiaExpress) return false;
    if (filters.shopGlobal !== void 0 && product.isShopGlobal !== filters.shopGlobal) return false;
    if (filters.tags?.length > 0) {
      if (!product.tags || !filters.tags.some((tag) => product.tags?.includes(tag))) return false;
    }
    return true;
  });
}
function getFilterOptions(products2) {
  const brands = Array.from(new Set(products2.map((p) => p.brand))).filter(Boolean).sort();
  const sellers = Array.from(new Set(products2.map((p) => p.seller))).filter(Boolean).sort();
  const tags = Array.from(new Set(products2.flatMap((p) => p.tags ?? []))).filter(Boolean).sort();
  const prices = products2.map((p) => p.price);
  return {
    brands,
    sellers,
    tags,
    priceRange: {
      min: Math.floor(Math.min(...prices.length ? prices : [0])),
      max: Math.ceil(Math.max(...prices.length ? prices : [0]))
    }
  };
}

// server/routers.ts
var appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true
      };
    })
  }),
  jumia: router({
    search: publicProcedure.input(z3.object({
      query: z3.string(),
      country: z3.string().default("NG"),
      page: z3.number().default(1)
    })).query(async ({ input }) => {
      try {
        const { products: products2, hasMore, debug } = await fetchJumiaPage(
          input.query,
          input.page,
          { country: input.country }
        );
        return { products: products2, hasMore, error: null, debug: debug ?? null };
      } catch (error) {
        return {
          products: [],
          hasMore: false,
          error: error instanceof Error ? error.message : "Unknown error",
          debug: null
        };
      }
    }),
    searchByUrl: publicProcedure.input(z3.object({
      url: z3.string().url()
    })).query(async ({ input }) => {
      try {
        const { products: products2, hasMore, debug } = await fetchJumiaByUrl(input.url);
        return { products: products2, hasMore, error: null, debug: debug ?? null };
      } catch (error) {
        return {
          products: [],
          hasMore: false,
          error: error instanceof Error ? error.message : "Unknown error",
          debug: null
        };
      }
    }),
    searchBySkuList: publicProcedure.input(z3.object({
      skus: z3.array(z3.string()),
      country: z3.string().default("NG")
    })).query(async ({ input }) => {
      try {
        const products2 = await fetchProductsBySkuList(input.skus, {
          country: input.country
        });
        return { products: products2, error: null };
      } catch (error) {
        return {
          products: [],
          error: error instanceof Error ? error.message : "Unknown error"
        };
      }
    }),
    filter: publicProcedure.input(z3.object({
      products: z3.array(z3.any()),
      filters: z3.object({
        brands: z3.array(z3.string()).optional(),
        sellers: z3.array(z3.string()).optional(),
        jumiaExpress: z3.boolean().optional(),
        minPrice: z3.number().optional(),
        maxPrice: z3.number().optional(),
        minRating: z3.number().optional(),
        tags: z3.array(z3.string()).optional()
      }).optional()
    })).query(({ input }) => {
      const filtered = filterProducts(input.products, input.filters || {});
      const options = getFilterOptions(filtered);
      return { products: filtered, filterOptions: options };
    }),
    getFilterOptions: publicProcedure.input(z3.object({
      products: z3.array(z3.any())
    })).query(({ input }) => {
      return getFilterOptions(input.products);
    }),
    exportCsv: publicProcedure.input(z3.object({
      products: z3.array(z3.any())
    })).query(({ input }) => {
      const csv = generateCsv(input.products);
      return { csv };
    })
  })
});
function generateCsv(products2) {
  if (products2.length === 0) {
    return "No products to export";
  }
  const headers = [
    "SKU",
    "Name",
    "Brand",
    "Category",
    "Price",
    "Old Price",
    "Discount",
    "Rating",
    "Total Ratings",
    "Seller",
    "Jumia Express",
    "Shop Global",
    "Image URL",
    "Product URL",
    "Stock",
    "Tags"
  ];
  const rows = products2.map((product) => [
    escapeCSV(product.sku),
    escapeCSV(product.name),
    escapeCSV(product.brand),
    escapeCSV(product.category),
    product.price || "",
    product.oldPrice || "",
    escapeCSV(product.discount || ""),
    product.rating || "",
    product.totalRatings || "",
    escapeCSV(product.seller || ""),
    product.isJumiaExpress ? "Yes" : "No",
    product.isShopGlobal ? "Yes" : "No",
    escapeCSV(product.image),
    escapeCSV(product.url),
    escapeCSV(product.stock || ""),
    product.tags ? product.tags.join("; ") : ""
  ]);
  const csvContent = [
    headers.join(","),
    ...rows.map((row) => row.join(","))
  ].join("\n");
  return csvContent;
}
function escapeCSV(value) {
  if (!value) return "";
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// server/_core/context.ts
async function createContext(opts) {
  let user = null;
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    user = null;
  }
  return {
    req: opts.req,
    res: opts.res,
    user
  };
}

// server/_core/vite.ts
import express from "express";
import fs2 from "fs";
import { nanoid } from "nanoid";
import path2 from "path";
import { createServer as createViteServer } from "vite";

// vite.config.ts
import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";
var PROJECT_ROOT = import.meta.dirname;
var LOG_DIR = path.join(PROJECT_ROOT, ".manus-logs");
var MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024;
var TRIM_TARGET_BYTES = Math.floor(MAX_LOG_SIZE_BYTES * 0.6);
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}
function trimLogFile(logPath, maxSize) {
  try {
    if (!fs.existsSync(logPath) || fs.statSync(logPath).size <= maxSize) {
      return;
    }
    const lines = fs.readFileSync(logPath, "utf-8").split("\n");
    const keptLines = [];
    let keptBytes = 0;
    const targetSize = TRIM_TARGET_BYTES;
    for (let i = lines.length - 1; i >= 0; i--) {
      const lineBytes = Buffer.byteLength(`${lines[i]}
`, "utf-8");
      if (keptBytes + lineBytes > targetSize) break;
      keptLines.unshift(lines[i]);
      keptBytes += lineBytes;
    }
    fs.writeFileSync(logPath, keptLines.join("\n"), "utf-8");
  } catch {
  }
}
function writeToLogFile(source, entries) {
  if (entries.length === 0) return;
  ensureLogDir();
  const logPath = path.join(LOG_DIR, `${source}.log`);
  const lines = entries.map((entry) => {
    const ts = (/* @__PURE__ */ new Date()).toISOString();
    return `[${ts}] ${JSON.stringify(entry)}`;
  });
  fs.appendFileSync(logPath, `${lines.join("\n")}
`, "utf-8");
  trimLogFile(logPath, MAX_LOG_SIZE_BYTES);
}
function vitePluginManusDebugCollector() {
  return {
    name: "manus-debug-collector",
    transformIndexHtml(html) {
      if (process.env.NODE_ENV === "production") {
        return html;
      }
      return {
        html,
        tags: [
          {
            tag: "script",
            attrs: {
              src: "/__manus__/debug-collector.js",
              defer: true
            },
            injectTo: "head"
          }
        ]
      };
    },
    configureServer(server) {
      server.middlewares.use("/__manus__/logs", (req, res, next) => {
        if (req.method !== "POST") {
          return next();
        }
        const handlePayload = (payload) => {
          if (payload.consoleLogs?.length > 0) {
            writeToLogFile("browserConsole", payload.consoleLogs);
          }
          if (payload.networkRequests?.length > 0) {
            writeToLogFile("networkRequests", payload.networkRequests);
          }
          if (payload.sessionEvents?.length > 0) {
            writeToLogFile("sessionReplay", payload.sessionEvents);
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        };
        const reqBody = req.body;
        if (reqBody && typeof reqBody === "object") {
          try {
            handlePayload(reqBody);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
          return;
        }
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          try {
            const payload = JSON.parse(body);
            handlePayload(payload);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
        });
      });
    }
  };
}
var plugins = [react(), tailwindcss(), jsxLocPlugin(), vitePluginManusRuntime(), vitePluginManusDebugCollector()];
var vite_config_default = defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets")
    }
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true
  },
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1"
    ],
    fs: {
      strict: true,
      deny: ["**/.*"]
    }
  }
});

// server/_core/vite.ts
async function setupVite(app, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    server: serverOptions,
    appType: "custom"
  });
  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path2.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );
      let template = await fs2.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app) {
  const distPath = process.env.NODE_ENV === "development" ? path2.resolve(import.meta.dirname, "../..", "dist", "public") : path2.resolve(import.meta.dirname, "public");
  if (!fs2.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app.use(express.static(distPath));
  app.use("*", (_req, res) => {
    res.sendFile(path2.resolve(distPath, "index.html"));
  });
}

// server/_core/index.ts
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}
async function findAvailablePort(startPort = 3e3) {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}
async function startServer() {
  const app = express2();
  const server = createServer(app);
  app.use(cors({
    origin: process.env.FRONTEND_URL || true,
    credentials: true
  }));
  app.use(express2.json({ limit: "50mb" }));
  app.use(express2.urlencoded({ limit: "50mb", extended: true }));
  registerOAuthRoutes(app);
  registerChatRoutes(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
startServer().catch(console.error);
