# Plot progress smoke checklist

Manual acceptance checks for SillyTavern 1.18.0.

1. Reload SillyTavern 1.18.0 and confirm one book icon appears in the left chat toolbar.
2. Open the menu and confirm `操作台 / separator / 剧情设置 / D&D 设置` order.
3. In 剧情设置, paste the four-node JSON from the design doc; confirm malformed JSON cannot save and valid JSON can.
4. Reopen 操作台; confirm all four nodes are visible in one fixed-height scroll region, node 1 is grey, node 2 is highlighted, and the advance button does not scroll.
5. Click 进入下一剧情; confirm node 2 becomes grey, node 3 becomes current, and reopening the chat preserves that state.
6. Inspect one normal generation request and one regenerate request; confirm the hidden plot prompt contains summary + nodes 1–3 and does not contain node 4.
7. Switch to another chat; confirm its plot is independent and no stale prompt or unsaved editor text follows the switch.
8. Delete the current node in JSON, save, and confirm the UI reports reset to the first node.
9. Reach the last node and confirm the button reads `已到最后节点` and cannot save another advance.
