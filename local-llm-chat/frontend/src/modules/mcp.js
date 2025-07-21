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
