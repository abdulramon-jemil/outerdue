// eslint-disable-next-line eslint-comments/disable-enable-pair
/* eslint-disable max-classes-per-file */

import { GuardedType, NonNegativeRangeList, LastItem } from "@/lib/types"

import {
  BaseBodyType,
  BaseQueryType,
  CommandDef,
  RawCommandNodeSchema,
  JSNodeHandlerResult,
  HandlerResultToNodeResult,
  SQLNodeHandlerResult,
  parseCommandResultJSON
} from "./shared"

/**
 * Method and body are ommitted because:
 * - Method is sourced from the definition of the command.
 * - Body is conditionally required/suppliable depending on the method.
 */
type CommandEndpointRequestInit = Omit<RequestInit, "method" | "body">
export type CommandEndpointResult =
  | HandlerResultToNodeResult<CommandDef, JSNodeHandlerResult>
  | HandlerResultToNodeResult<CommandDef, SQLNodeHandlerResult>

class TypedResponse<T extends CommandEndpointResult> extends Response {
  async json(): Promise<T> {
    const resultText = await this.text()
    return parseCommandResultJSON(resultText) as T
  }
}

export async function fetchTypedResponse<T extends CommandEndpointResult>(
  ...fetchParams: Parameters<typeof fetch>
): Promise<TypedResponse<T>> {
  const response = await fetch(...fetchParams)
  return new TypedResponse<T>(response.body, response)
}

type CommandFetchHeadersParam<CmdDef extends CommandDef> =
  CmdDef["headers"] extends Record<string, unknown>
    ? {
        headers: { [K in keyof CmdDef["headers"]]?: string } & {
          // Remove optionality for required params
          [K in keyof CmdDef["headers"] as CmdDef["headers"][K] extends true
            ? K
            : never]-?: string
        }
      }
    : { headers?: undefined }

type CommandEndpointFetchParams<CmdDef extends CommandDef> = CmdDef extends {
  method: "GET" | "DELETE"
}
  ? {
      // This extraction should not have to be done, because it's possible that
      // the body type defined is assignable to `BaseQueryType`. However, there're
      // limitations with typescript that I've not been able to work around.
      query: Extract<GuardedType<CmdDef["payloadValidator"]>, BaseQueryType>
      body?: undefined
      requestInit?: CommandEndpointRequestInit
    } & CommandFetchHeadersParam<CmdDef>
  : CmdDef extends { method: "POST" | "PUT" | "PATCH" }
  ? {
      body: Extract<GuardedType<CmdDef["payloadValidator"]>, BaseBodyType>
      query?: undefined
      requestInit?: CommandEndpointRequestInit
    } & CommandFetchHeadersParam<CmdDef>
  : never

export class CommandEndpoint<CmdDef extends CommandDef> {
  config: {
    command: CmdDef
    id: CmdDef["id"]
    path: CmdDef["path"]
    method: CmdDef["method"]
  }

  constructor(config: {
    command: CmdDef
    id: CmdDef["id"]
    path: CmdDef["path"]
    method: CmdDef["method"]
  }) {
    this.config = config
  }

  async fetch(params: CommandEndpointFetchParams<CmdDef>) {
    const response = await this.fetchResponse(params)
    return response.json()
  }

  async fetchResponse(params: CommandEndpointFetchParams<CmdDef>) {
    const { origin } = this.config.command.interface
    const {
      path,
      command: { method }
    } = this.config

    const endpointURL = new URL(path, origin)
    let init: RequestInit = {
      ...params.requestInit,
      method
    }

    if (params.query) {
      const { query } = params
      endpointURL.search = new URLSearchParams(query).toString()
    } else {
      const { body, headers } = params
      init = {
        ...init,
        headers: {
          ...init.headers,
          ...headers,
          "Content-Type":
            typeof body === "string" ? "text/plain" : "application/json"
        },
        body: JSON.stringify(body)
      }
    }

    return fetchTypedResponse<
      HandlerResultToNodeResult<
        CmdDef,
        RawCommandNodeSchema<
          CmdDef,
          // Use the result of the last node as endpoint result
          LastItem<NonNegativeRangeList<CmdDef["nodes"]["length"]>>
        >["result"] extends infer T
          ? T extends JSNodeHandlerResult | SQLNodeHandlerResult
            ? T
            : never
          : never
      >
    >(endpointURL, init)
  }
}