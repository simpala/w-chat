import {
    SaveSettings as GoSaveSettings,
    LoadSettings as GoLoadSettings
} from '../../wailsjs/go/main/App';

export async function getMcpServers() {
    try {
        const serversJson = await window.go.main.App.GetMcpServers();
        const mcpConfig = JSON.parse(serversJson);
        return mcpConfig.mcpServers || {};
    } catch (error) {
        console.error("ERROR: Frontend: Error loading MCP servers:", error);
        return {};
    }
}

export async function spawnMcpServer(serverName, serverConfig) {
    try {
        const result = await window.go.main.App.SpawnMcpServer(serverName, serverConfig.command, serverConfig.args, serverConfig.env);
        console.log(result);
    } catch (error) {
        console.error(`Error spawning MCP server ${serverName}:`, error);
    }
}
