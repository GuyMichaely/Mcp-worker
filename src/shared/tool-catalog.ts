export const WorkerToolCatalog = [
  {
    "name": "machine_status",
    "title": "Machine service status",
    "description": "Report service, workspace, active policy, and native-helper status.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "policy_explain",
    "title": "Explain policy decision",
    "description": "Preview the exact policy decision for a proposed tool capability and subject without performing it.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tool": {
          "type": "string",
          "minLength": 1
        },
        "capability": {
          "type": "string",
          "enum": [
            "machine.status",
            "policy.inspect",
            "fs.read",
            "fs.create",
            "fs.write",
            "fs.delete",
            "process.execute.sandboxed",
            "process.execute.unsandboxed",
            "process.network",
            "desktop.observe",
            "desktop.control",
            "clipboard.read",
            "clipboard.write",
            "transfer.import",
            "transfer.export"
          ]
        },
        "subject_kind": {
          "type": "string",
          "enum": [
            "path",
            "executable",
            "app",
            "special"
          ]
        },
        "subject_value": {
          "type": "string"
        }
      },
      "required": [
        "tool",
        "capability"
      ],
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "fs_list",
    "title": "List files",
    "description": "List the direct children of an allowed directory on the Windows machine.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "minLength": 1,
          "description": "An absolute Windows path."
        }
      },
      "required": [
        "path"
      ],
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "fs_stat",
    "title": "Inspect file",
    "description": "Return metadata and a SHA-256 hash for an allowed file or directory.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "minLength": 1,
          "description": "An absolute Windows path."
        },
        "include_hash": {
          "default": true,
          "type": "boolean"
        }
      },
      "required": [
        "path"
      ],
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "fs_read",
    "title": "Read text file",
    "description": "Read a bounded UTF-8 range from an allowed text file. Use file_export for binary or large files.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "minLength": 1,
          "description": "An absolute Windows path."
        },
        "offset": {
          "default": 0,
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "max_bytes": {
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 9007199254740991
        }
      },
      "required": [
        "path"
      ],
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "fs_search",
    "title": "Search files",
    "description": "Recursively search file names and bounded text content under an allowed directory. Symbolic links are not followed.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "minLength": 1,
          "description": "An absolute Windows path."
        },
        "query": {
          "type": "string",
          "minLength": 1
        },
        "regex": {
          "default": false,
          "type": "boolean"
        },
        "include_content": {
          "default": true,
          "type": "boolean"
        },
        "max_results": {
          "default": 200,
          "type": "integer",
          "minimum": 1,
          "maximum": 1000
        }
      },
      "required": [
        "path",
        "query"
      ],
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "fs_write",
    "title": "Write text file",
    "description": "Create or atomically replace an allowed UTF-8 text file. expected_sha256 prevents overwriting a changed file.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "minLength": 1,
          "description": "An absolute Windows path."
        },
        "text": {
          "type": "string"
        },
        "expected_sha256": {
          "type": "string",
          "pattern": "^[a-fA-F0-9]{64}$"
        },
        "create_parent": {
          "default": false,
          "type": "boolean"
        }
      },
      "required": [
        "path",
        "text"
      ],
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "fs_replace",
    "title": "Replace exact text",
    "description": "Apply ordered exact-text replacements to an allowed UTF-8 file, with optional SHA-256 concurrency protection.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "minLength": 1,
          "description": "An absolute Windows path."
        },
        "replacements": {
          "minItems": 1,
          "maxItems": 100,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "old_text": {
                "type": "string",
                "minLength": 1
              },
              "new_text": {
                "type": "string"
              },
              "replace_all": {
                "default": false,
                "type": "boolean"
              }
            },
            "required": [
              "old_text",
              "new_text"
            ]
          }
        },
        "expected_sha256": {
          "type": "string",
          "pattern": "^[a-fA-F0-9]{64}$"
        }
      },
      "required": [
        "path",
        "replacements"
      ],
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "fs_mkdir",
    "title": "Create directory",
    "description": "Create an allowed directory, including missing parents when requested.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "minLength": 1,
          "description": "An absolute Windows path."
        },
        "recursive": {
          "default": true,
          "type": "boolean"
        }
      },
      "required": [
        "path"
      ],
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "fs_copy",
    "title": "Copy file or directory",
    "description": "Copy an allowed file or directory to an allowed destination.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "source": {
          "type": "string",
          "minLength": 1,
          "description": "An absolute Windows path."
        },
        "destination": {
          "type": "string",
          "minLength": 1,
          "description": "An absolute Windows path."
        },
        "overwrite": {
          "default": false,
          "type": "boolean"
        }
      },
      "required": [
        "source",
        "destination"
      ],
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "fs_move",
    "title": "Move file or directory",
    "description": "Move an allowed file or directory to an allowed destination.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "source": {
          "type": "string",
          "minLength": 1,
          "description": "An absolute Windows path."
        },
        "destination": {
          "type": "string",
          "minLength": 1,
          "description": "An absolute Windows path."
        },
        "overwrite": {
          "default": false,
          "type": "boolean"
        }
      },
      "required": [
        "source",
        "destination"
      ],
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "fs_delete",
    "title": "Delete file or directory",
    "description": "Move an allowed file or directory into the server's recoverable trash. Permanent deletion requires permanent=true.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "minLength": 1,
          "description": "An absolute Windows path."
        },
        "permanent": {
          "default": false,
          "type": "boolean"
        }
      },
      "required": [
        "path"
      ],
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "file_import",
    "title": "Import ChatGPT file",
    "description": "Stream a ChatGPT-authorized file into an allowed local destination without exposing its bytes to the model.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "file": {
          "type": "object",
          "properties": {
            "download_url": {
              "type": "string",
              "format": "uri"
            },
            "file_id": {
              "type": "string",
              "minLength": 1
            },
            "mime_type": {
              "type": "string"
            },
            "file_name": {
              "type": "string"
            }
          },
          "required": [
            "download_url",
            "file_id"
          ]
        },
        "destination": {
          "type": "string",
          "minLength": 1,
          "description": "An absolute Windows path."
        },
        "expected_sha256": {
          "type": "string"
        }
      },
      "required": [
        "file",
        "destination"
      ],
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    },
    "_meta": {
      "openai/fileParams": [
        "file"
      ]
    }
  },
  {
    "name": "file_export",
    "title": "Export local file",
    "description": "Expose an allowed local file to ChatGPT through a short-lived signed download without putting file bytes in model context.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "minLength": 1,
          "description": "An absolute Windows path."
        },
        "expires_minutes": {
          "default": 30,
          "type": "integer",
          "minimum": 1,
          "maximum": 1440
        }
      },
      "required": [
        "path"
      ],
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": true
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "process_run",
    "title": "Run process",
    "description": "Run a program or raw PowerShell/cmd command and wait for it to finish. Strict sandbox failure never falls back to unsandboxed execution.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "spec": {
          "oneOf": [
            {
              "type": "object",
              "properties": {
                "kind": {
                  "type": "string",
                  "const": "exec"
                },
                "executable": {
                  "type": "string",
                  "minLength": 1
                },
                "args": {
                  "default": [],
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                }
              },
              "required": [
                "kind",
                "executable"
              ]
            },
            {
              "type": "object",
              "properties": {
                "kind": {
                  "type": "string",
                  "const": "shell"
                },
                "shell": {
                  "type": "string",
                  "enum": [
                    "powershell",
                    "cmd"
                  ]
                },
                "command": {
                  "type": "string"
                }
              },
              "required": [
                "kind",
                "shell",
                "command"
              ]
            }
          ]
        },
        "cwd": {
          "default": "C:\\Users\\GuyMichaely\\projects\\pluginworkspace",
          "type": "string",
          "minLength": 1
        },
        "environment": {
          "default": {},
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {
            "type": "string"
          }
        },
        "mode": {
          "default": "profile",
          "type": "string",
          "enum": [
            "profile",
            "strict",
            "unsandboxed"
          ]
        },
        "network": {
          "default": true,
          "type": "boolean"
        },
        "stdin": {
          "type": "string"
        },
        "timeout_ms": {
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 9007199254740991
        }
      },
      "required": [
        "spec"
      ],
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "openWorldHint": true
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "process_start",
    "title": "Start interactive process",
    "description": "Start a current-user process session. Strict interactive sessions are not supported yet and fail closed.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "spec": {
          "oneOf": [
            {
              "type": "object",
              "properties": {
                "kind": {
                  "type": "string",
                  "const": "exec"
                },
                "executable": {
                  "type": "string",
                  "minLength": 1
                },
                "args": {
                  "default": [],
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                }
              },
              "required": [
                "kind",
                "executable"
              ]
            },
            {
              "type": "object",
              "properties": {
                "kind": {
                  "type": "string",
                  "const": "shell"
                },
                "shell": {
                  "type": "string",
                  "enum": [
                    "powershell",
                    "cmd"
                  ]
                },
                "command": {
                  "type": "string"
                }
              },
              "required": [
                "kind",
                "shell",
                "command"
              ]
            }
          ]
        },
        "cwd": {
          "default": "C:\\Users\\GuyMichaely\\projects\\pluginworkspace",
          "type": "string",
          "minLength": 1
        },
        "environment": {
          "default": {},
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {
            "type": "string"
          }
        },
        "mode": {
          "default": "profile",
          "type": "string",
          "enum": [
            "profile",
            "strict",
            "unsandboxed"
          ]
        },
        "network": {
          "default": true,
          "type": "boolean"
        }
      },
      "required": [
        "spec"
      ],
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "openWorldHint": true
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "process_poll",
    "title": "Poll process",
    "description": "Read new output and status from a process session started by this server.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "session_id": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "after_offset": {
          "default": 0,
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        }
      },
      "required": [
        "session_id"
      ],
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "process_stdin",
    "title": "Write process input",
    "description": "Write text to an owned process session, optionally closing stdin.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "session_id": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "text": {
          "default": "",
          "type": "string"
        },
        "close": {
          "default": false,
          "type": "boolean"
        }
      },
      "required": [
        "session_id"
      ],
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "process_terminate",
    "title": "Terminate process",
    "description": "Terminate a process session owned by this server.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "session_id": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      "required": [
        "session_id"
      ],
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "process_list",
    "title": "List owned processes",
    "description": "List process sessions started by this MCP server.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "desktop_status",
    "title": "Desktop status",
    "description": "Report whether an unlocked interactive Windows desktop and the native helper are available.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "desktop_list_windows",
    "title": "List approved windows",
    "description": "List visible top-level windows whose owning applications have desktop-observe permission.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "desktop_capture",
    "title": "Capture window or desktop",
    "description": "Capture an approved window, or the whole desktop when desktop://session is allowed. Returns a PNG image and frame ID.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "window_id": {
          "type": "string"
        }
      },
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "desktop_focus",
    "title": "Focus window",
    "description": "Bring an approved window to the foreground.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "window_id": {
          "type": "string"
        }
      },
      "required": [
        "window_id"
      ],
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "desktop_click",
    "title": "Click desktop",
    "description": "Click an approved window at coordinates from a recent captured frame.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "window_id": {
          "type": "string"
        },
        "frame_id": {
          "type": "string"
        },
        "x": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
        },
        "y": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
        },
        "button": {
          "default": "left",
          "type": "string",
          "enum": [
            "left",
            "right",
            "middle"
          ]
        },
        "clicks": {
          "default": 1,
          "type": "integer",
          "minimum": 1,
          "maximum": 3
        }
      },
      "required": [
        "window_id",
        "frame_id",
        "x",
        "y"
      ],
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "desktop_scroll",
    "title": "Scroll window",
    "description": "Scroll an approved window at coordinates from a recent captured frame.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "window_id": {
          "type": "string"
        },
        "frame_id": {
          "type": "string"
        },
        "x": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
        },
        "y": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
        },
        "delta": {
          "type": "integer",
          "minimum": -12000,
          "maximum": 12000
        }
      },
      "required": [
        "window_id",
        "frame_id",
        "x",
        "y",
        "delta"
      ],
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "desktop_drag",
    "title": "Drag in window",
    "description": "Drag between two coordinates in an approved window using a recent captured frame.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "window_id": {
          "type": "string"
        },
        "frame_id": {
          "type": "string"
        },
        "start_x": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
        },
        "start_y": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
        },
        "end_x": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
        },
        "end_y": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
        },
        "duration_ms": {
          "default": 400,
          "type": "integer",
          "minimum": 50,
          "maximum": 5000
        }
      },
      "required": [
        "window_id",
        "frame_id",
        "start_x",
        "start_y",
        "end_x",
        "end_y"
      ],
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "desktop_type",
    "title": "Type text",
    "description": "Focus an approved window and type Unicode text using Windows input injection.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "window_id": {
          "type": "string"
        },
        "text": {
          "type": "string"
        },
        "interval_ms": {
          "default": 0,
          "type": "integer",
          "minimum": 0,
          "maximum": 1000
        }
      },
      "required": [
        "window_id",
        "text"
      ],
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "desktop_key",
    "title": "Send key chord",
    "description": "Focus an approved window and send a key chord such as CTRL+S or ALT+F4.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "window_id": {
          "type": "string"
        },
        "keys": {
          "minItems": 1,
          "maxItems": 8,
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1
          }
        }
      },
      "required": [
        "window_id",
        "keys"
      ],
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "clipboard_read",
    "title": "Read clipboard",
    "description": "Read text from the global Windows clipboard when clipboard://session is allowed.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "clipboard_write",
    "title": "Write clipboard",
    "description": "Replace text in the global Windows clipboard when clipboard://session is allowed.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "text": {
          "type": "string"
        }
      },
      "required": [
        "text"
      ],
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  },
  {
    "name": "desktop_launch",
    "title": "Launch desktop application",
    "description": "Launch an application whose executable has desktop-control permission.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "executable": {
          "type": "string",
          "minLength": 1
        },
        "args": {
          "default": [],
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "executable"
      ],
      "$schema": "http://json-schema.org/draft-07/schema#"
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "openWorldHint": false
    },
    "execution": {
      "taskSupport": "forbidden"
    }
  }
] as const;
