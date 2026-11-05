# Workflow diagrams

`make_wf_pdf.py` renders the three workflow diagrams (`design.dot`, `access.dot`,
`steward.dot`) with Graphviz and assembles `Cortex_Data_Catalog_Workflows.pdf`.
The diagrams mirror the server's state machine (`DESIGN_ACTIONS` in `server.js`) —
update the `.dot` files whenever a transition, role or notification changes.

    sudo apt install -y graphviz && pip install reportlab pillow
    python3 docs/workflows/make_wf_pdf.py <output.pdf> <version>

The PDF is a one-off document — regenerate it only when asked (it is not part of the release routine).
