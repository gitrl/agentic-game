import type OpenAI from "openai";

type Tool = OpenAI.ChatCompletionTool;

export const TOOL_DEFINITIONS: Tool[] = [
  {
    type: "function",
    function: {
      name: "resolve_player_input",
      description:
        "解析玩家的自然语言输入，声明你对其意图的理解。当玩家通过自然语言（非选项点击）进行操作时必须调用。",
      parameters: {
        type: "object",
        properties: {
          resolvedChoiceId: {
            type: "string",
            description: "映射到的选项 ID（如果能对应到上一轮给出的选项），否则填写自拟的动作 ID（英文 snake_case）"
          },
          interpretation: {
            type: "string",
            description: "对玩家意图的一句话理解（中文，≤ 40 字）"
          },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description: "解析置信度"
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
      description:
        "根据本轮叙事发展更新游戏五维数值和命运阻力。每项为增量（delta），代码会 clamp 到合法范围。每轮必须调用一次。",
      parameters: {
        type: "object",
        properties: {
          truthScore: {
            type: "integer",
            minimum: -10,
            maximum: 10,
            description: "真相分变化"
          },
          judgeTrust: {
            type: "integer",
            minimum: -10,
            maximum: 10,
            description: "法官信任变化"
          },
          juryBias: {
            type: "integer",
            minimum: -15,
            maximum: 15,
            description: "陪审偏见变化（正值有利控方，负值有利辩方）"
          },
          publicPressure: {
            type: "integer",
            minimum: -10,
            maximum: 10,
            description: "舆论压力变化"
          },
          evidenceIntegrity: {
            type: "integer",
            minimum: -10,
            maximum: 10,
            description: "证据完整度变化"
          },
          fateDelta: {
            type: "integer",
            minimum: -8,
            maximum: 8,
            description: "命运阻力变化（正值靠近重生触发，负值远离）"
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
      description:
        "为玩家生成 3-5 个当前回合可用的策略选项。选项应基于当前剧情阶段和状态，不可重复上一轮的选项。每轮必须调用一次。",
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
                  description: "选项唯一标识（英文 snake_case）"
                },
                title: {
                  type: "string",
                  description: "选项标题（≤ 10 字中文）"
                },
                description: {
                  type: "string",
                  description: "选项描述（≤ 30 字中文）"
                },
                impactHint: {
                  type: "string",
                  description: "影响提示（≤ 10 字中文）"
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
      description:
        "更新证据池中某项证据的可信度或状态，或新增一项证据。在剧情涉及证据变化时按需调用。",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["update", "add"],
            description: "update = 修改已有证据，add = 新增证据"
          },
          evidenceId: {
            type: "string",
            description: "证据 ID（update 时必填，add 时自动生成）"
          },
          title: {
            type: "string",
            description: "证据标题（add 时必填）"
          },
          source: {
            type: "string",
            description: "证据来源（add 时必填）"
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
            description: "新状态（可选）"
          },
          newNote: {
            type: "string",
            description: "更新备注（可选）"
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
      description:
        "根据当前叙事中的互动，调整与某个 NPC 的信任值。立场会自动根据信任值重新计算。",
      parameters: {
        type: "object",
        properties: {
          npcId: {
            type: "string",
            enum: ["chiefProsecutor", "presidingJudge", "keyWitness", "investigatorXu"],
            description: "NPC 标识"
          },
          trustDelta: {
            type: "integer",
            minimum: -15,
            maximum: 15,
            description: "信任值变化"
          },
          reason: {
            type: "string",
            description: "变化原因（≤ 30 字中文）"
          }
        },
        required: ["npcId", "trustDelta", "reason"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "write_memory_anchor",
      description:
        "当本轮出现重要转折或关键发现时，写入一条长期记忆锚点。锚点将在重生后保留，帮助后续周目参考。不要滥用，仅在真正重要的事件发生时调用。",
      parameters: {
        type: "object",
        properties: {
          anchor: {
            type: "string",
            description: "锚点内容（≤ 30 字中文，概括关键事件）"
          }
        },
        required: ["anchor"]
      }
    }
  }
];
