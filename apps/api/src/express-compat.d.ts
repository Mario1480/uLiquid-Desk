import type {
  Express as CoreExpress,
  NextFunction as CoreNextFunction,
  Request as CoreRequest,
  RequestHandler as CoreRequestHandler,
  Response as CoreResponse
} from "express-serve-static-core";

declare global {
  namespace express {
    type Express = CoreExpress;
    type NextFunction = CoreNextFunction;
    type Request = CoreRequest;
    type RequestHandler = CoreRequestHandler;
    type Response = CoreResponse;
  }
}

declare module "express" {
  export type Express = CoreExpress;
  export type NextFunction = CoreNextFunction;
  export type Request = CoreRequest;
  export type RequestHandler = CoreRequestHandler;
  export type Response = CoreResponse;
}
