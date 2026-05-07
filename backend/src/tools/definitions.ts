import type OpenAI from "openai";

type Tool = OpenAI.ChatCompletionTool;

export const TOOL_DEFINITIONS: Tool[] = [
  {
    type: "function",
    function: {
      name: "resolve_player_input",
      description: "仅用于自然语言输入：解析意图并回传映射结果。",
      parameters: {
        type: "object",
        properties: {
          resolvedChoiceId: {
            type: "string",
            description: "映射选项ID；无法映射时给动作ID（snake_case）"
          },
          interpretation: {
            type: "string",
            description: "一句话意图理解（中文）"
          },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description: "置信度"
          }
        },
        required: ["resolvedChoiceId", "interpretation", "confidence"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_stats",
      description: "更新五维数值与命运阻力（增量）。每轮必调一次。",
      parameters: {
        type: "object",
        properties: {
          truthScore: {
            type: "integer",
            minimum: -10,
            maximum: 10,
            description: "真相分增量"
          },
          judgeTrust: {
            type: "integer",
            minimum: -10,
            maximum: 10,
            description: "法官信任增量"
          },
          juryBias: {
            type: "integer",
            minimum: -15,
            maximum: 15,
            description: "陪审偏见增量（+控方，-辩方）"
          },
          publicPressure: {
            type: "integer",
            minimum: -10,
            maximum: 10,
            description: "舆论压力增量"
          },
          evidenceIntegrity: {
            type: "integer",
            minimum: -10,
            maximum: 10,
            description: "证据完整度增量"
          },
          fateDelta: {
            type: "integer",
            minimum: -8,
            maximum: 8,
            description: "命运阻力增量（+更危险）"
          }
        },
        required: ["truthScore", "judgeTrust", "juryBias", "publicPressure", "evidenceIntegrity", "fateDelta"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "generate_choices",
      description: "生成下一轮 3-5 个策略选项。每轮必调一次。",
      parameters: {
        type: "object",
        properties: {
          choices: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: {
                  type: "string",
                  description: "选项ID（snake_case）"
                },
                title: {
                  type: "string",
                  description: "标题（简短中文）"
                },
                description: {
                  type: "string",
                  description: "描述（简短中文）"
                },
                impactHint: {
                  type: "string",
                  description: "风险提示（简短中文）"
                }
              },
              required: ["id", "title", "description", "impactHint"]
            },
            minItems: 3,
            maxItems: 5
          }
        },
        required: ["choices"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_evidence",
      description: "更新或新增证据。",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["update", "add"],
            description: "update=修改，add=新增"
          },
          evidenceId: {
            type: "string",
            description: "证据ID（update时建议提供）"
          },
          title: {
            type: "string",
            description: "证据标题（add时使用）"
          },
          source: {
            type: "string",
            description: "证据来源（add时使用）"
          },
          reliabilityDelta: {
            type: "integer",
            minimum: -10,
            maximum: 10,
            description: "可信度增量"
          },
          newStatus: {
            type: "string",
            enum: ["unverified", "verified", "challenged"],
            description: "新状态"
          },
          newNote: {
            type: "string",
            description: "备注"
          }
        },
        required: ["action"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "shift_npc_relation",
      description: "调整 NPC 信任值与关系倾向。",
      parameters: {
        type: "object",
        properties: {
          npcId: {
            type: "string",
            enum: ["chiefProsecutor", "presidingJudge", "keyWitness", "investigatorXu"],
            description: "NPC标识"
          },
          trustDelta: {
            type: "integer",
            minimum: -15,
            maximum: 15,
            description: "信任值增量"
          },
          reason: {
            type: "string",
            description: "变化原因"
          }
        },
        required: ["npcId", "trustDelta", "reason"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "submit_summary",
      description: "提交本轮一句话摘要（中文，<=40字），用于回放与前端展示。每轮必调一次。",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "一句话摘要（中文，<=40字）"
          }
        },
        required: ["summary"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "write_memory_anchor",
      description: "写入长期记忆锚点（仅关键事件）。",
      parameters: {
        type: "object",
        properties: {
          anchor: {
            type: "string",
            description: "锚点内容（简短中文）"
          }
        },
        required: ["anchor"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "recall_memory",
      description: "主动检索历史记忆。按需调用——当玩家/叙事需要引用被动窗口外的旧事件、完整证据池、早期玩家行动、跨周目真相时使用。只读，不改状态。",
      parameters: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            enum: [
              "history_summaries",
              "replay_actions",
              "long_anchors",
              "mid_summary",
              "evidence_full",
              "known_truths"
            ],
            description: "检索范围：history_summaries=全部轮次摘要(上限20) / replay_actions=玩家完整历史行动(无上限) / long_anchors=长期锚点 / mid_summary=中期阶段摘要 / evidence_full=完整证据池 / known_truths=跨周目已知真相"
          },
          query: {
            type: "string",
            description: "可选关键词（中文，大小写不敏感）：匹配文本内容；不填则按时间倒序返回最新结果"
          },
          turnFrom: {
            type: "integer",
            minimum: 1,
            description: "可选：起始轮次（含），仅对 history_summaries/replay_actions 生效"
          },
          turnTo: {
            type: "integer",
            minimum: 1,
            description: "可选：结束轮次（含），仅对 history_summaries/replay_actions 生效"
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 10,
            description: "返回结果上限（默认 5，最多 10）"
          }
        },
        required: ["scope"]
      }
    }
  }
];
