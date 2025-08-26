from playwright.sync_api import Page, expect
import logging

logging.basicConfig(level=logging.INFO)

def test_harmony_tools_display(page: Page):
    """
    This test verifies that when the 'Use Harmony Format' checkbox is checked,
    the MCP manager correctly displays the available tools.
    """
    try:
        # 1. Arrange: Go to the application homepage.
        url = "http://localhost:34115"
        logging.info(f"Navigating to {url}")
        page.goto(url, wait_until="networkidle")
        logging.info("Page loaded successfully.")

        # 2. Act: Open settings and enable Harmony format.
        settings_button = page.locator("#settingsToggleButton")
        logging.info("Clicking settings button.")
        settings_button.click()
        logging.info("Settings button clicked.")

        harmony_checkbox = page.locator("#harmonyToolsCheckbox")
        logging.info("Checking harmony checkbox.")
        harmony_checkbox.check()
        logging.info("Harmony checkbox checked.")

        # 3. Act: Open the MCP Manager.
        mcp_manager_button = page.locator("#mcpManagerButton")
        logging.info("Clicking MCP Manager button.")
        mcp_manager_button.click()
        logging.info("MCP Manager button clicked.")


        # 4. Assert: Check that the MCP manager is visible and contains server details.
        mcp_server_list = page.locator(".mcp-server-list")
        logging.info("Waiting for MCP server list to be visible.")
        expect(mcp_server_list).to_be_visible(timeout=10000)
        logging.info("MCP server list is visible.")

        # 5. Screenshot: Capture the final result for visual verification.
        screenshot_path = "jules-scratch/verification/verification.png"
        logging.info(f"Taking screenshot to {screenshot_path}")
        page.screenshot(path=screenshot_path)
        logging.info("Screenshot taken successfully.")

    except Exception as e:
        logging.error(f"An error occurred: {e}")
        # Take a screenshot on error to help debug
        page.screenshot(path="jules-scratch/verification/error.png")
        raise
