import type { ToolResult } from "./tool-result.js";

export function asMcpResult<T>(result: ToolResult<T>) {
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify(result)
    }],
    isError: !result.ok
  };
}
