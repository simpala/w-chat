from playwright.sync_api import Page, expect

def test_token_counter(page: Page):
    # 1. Arrange: Go to the application.
    page.goto("http://localhost:5173")

    # 2. Act: Click the "New Chat" button.
    new_chat_button = page.get_by_role("button", name="New Chat")
    new_chat_button.click()

    # 3. Act: Type a message in the input field.
    message_input = page.get_by_placeholder("Type your message...")
    message_input.fill("Hello, world!")

    # 4. Act: Click the "Send" button.
    send_button = page.get_by_role("button", name="Send")
    send_button.click()

    # 5. Assert: Wait for the token counters to appear.
    token_counter = page.locator("#token-counter")
    session_token_total = page.locator("#session-token-total")

    expect(token_counter).to_be_visible()
    expect(session_token_total).to_be_visible()

    # 6. Screenshot: Capture the final result for visual verification.
    page.screenshot(path="jules-scratch/verification/verification.png")
