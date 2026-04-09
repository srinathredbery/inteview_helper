const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const spawn = require("cross-spawn");

class McpManager {
    constructor() {
        this.servers = new Map(); // config -> { client, transport }
    }

    async addServer(configLine) {
        if (this.servers.has(configLine)) return true;

        try {
            console.log(`Connecting to MCP server: ${configLine}`);
            
            // Basic parsing for npx commands
            const parts = configLine.split(' ');
            const command = parts[0];
            const args = parts.slice(1);

            const transport = new StdioClientTransport({
                command,
                args,
                stderr: "inherit"
            });

            const client = new Client(
                { name: "interview-assistant", version: "1.0.0" },
                { capabilities: {} }
            );

            await client.connect(transport);
            this.servers.set(configLine, { client, transport });
            console.log(`Successfully connected to ${configLine}`);
            return true;
        } catch (err) {
            console.error(`Failed to connect to MCP server ${configLine}:`, err);
            return false;
        }
    }

    async removeServer(configLine) {
        const entry = this.servers.get(configLine);
        if (entry) {
            try {
                await entry.transport.close();
            } catch (e) {}
            this.servers.delete(configLine);
        }
    }

    getServers() {
        return Array.from(this.servers.keys());
    }

    async getContextFromAll(query) {
        let mcpContext = "";
        
        for (const [config, { client }] of this.servers.entries()) {
            try {
                console.log(`Querying MCP server ${config} for: ${query}`);
                
                // 1. Try to list resources related to query (simple keyword check)
                const resources = await client.listResources();
                if (resources && resources.resources) {
                    for (const res of resources.resources) {
                        const qLower = query.toLowerCase();
                        if (res.name.toLowerCase().includes(qLower) || res.uri.includes(qLower)) {
                            const content = await client.readResource({ uri: res.uri });
                            if (content && content.contents) {
                                mcpContext += `\n--- MCP Resource (${res.name}) ---\n${content.contents[0].text}\n`;
                            }
                        }
                    }
                }

                // 2. If server has tools, we could technically call them, 
                // but for now let's stick to resources and prompts.
                
            } catch (err) {
                console.error(`MCP Query Error (${config}):`, err.message);
            }
        }
        
        return mcpContext;
    }
}

module.exports = new McpManager();
