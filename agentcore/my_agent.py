from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent
from strands.models import BedrockModel
from strands.tools.mcp import MCPClient
from mcp import StdioServerParameters, stdio_client

MODEL_ID = "anthropic.claude-3-5-sonnet-20240620-v1:0"

# MCP client configuration
stdio_mcp_client = MCPClient(
    lambda: stdio_client(
        StdioServerParameters(
            command="uvx", args=["awslabs.aws-documentation-mcp-server@latest"]
        )
    )
)

app = BedrockAgentCoreApp()

# Global agent instance (will be initialized on first request)
agent = None
mcp_context_manager = None

def initialize_agent():
    """Initialize agent with MCP tools (call once per container lifecycle)"""
    global agent, mcp_context_manager

    if agent is None:
        # Enter MCP context and keep it open
        mcp_context_manager = stdio_mcp_client.__enter__()

        # Get tools from MCP server
        tools = stdio_mcp_client.list_tools_sync()

        # Create agent with tools
        agent = Agent(
            model=BedrockModel(model_id=MODEL_ID),
            tools=tools
        )

    return agent

@app.entrypoint
async def invoke(payload):
    """エージェントに質問を投げてレスポンスを取得する"""
    # Lazy initialization - agent is created on first request
    current_agent = initialize_agent()

    # Extract user prompt
    user_prompt = payload.get(
        "prompt",
        "No prompt found in input, please guide customer to create a json payload with prompt key"
    )

    # Stream response from agent
    agent_stream = current_agent.stream_async(user_prompt)
    async for event in agent_stream:
        if "event" in event:
            yield event

if __name__ == "__main__":
    try:
        app.run()
    finally:
        # Clean up MCP context on shutdown
        if mcp_context_manager is not None:
            stdio_mcp_client.__exit__(None, None, None)
