// Use the side panel when available; manifest action.default_popup is the
// fallback for Chrome versions/profiles where sidePanel cannot open.
if (chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    // Popup fallback still opens from the toolbar icon.
  });
}
