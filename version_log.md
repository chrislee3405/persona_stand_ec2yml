For version format x.y.z
x is the major version
y is the progressing updated functions
z is the minor bug fix

---
# version 0.3.0

- prompt construction architecture
    - system prompt
        - unchange status information orientated
    - user prompt
        - dynamic and situtional information orientated
- improve workflow of logging error model message
    - log error model message in message table
    - isolate error model message from functional feature
- change behaviour of unanthentication conversation id and invite code
    - treat as starting a new conversation instead of failure loop

---
# version 0.2.0

- model orchestration
    - workflow to gather material for natural language generation
        - categorize topic of the user message
        - retrieve reference document of that topic
        - BM25 algorithm to retrieve similiar past Q&A pair as reference
        - fetch summary and few recent message after summary
- summerization
    - a running summary is add in db conversation table
    - update a running summary every x turns of conversation

---
# version 0.1.1

- change authentication to cookie session signature
    - prevent conversation id tempering attack

---
# version 0.1.0

- Fundemential Architecture Estbulished(Github, Github Action, EC2, ECR, RDS, GCP etc.)
- Basic functionality
    - Basic UI page
    - database for conversation, dialogue, invite code
    - store conversation and dialogue in database
    - match invite code in database
    - connection to Vertex AI model
    - UX functionality
        - sustain conversation and inputed invite code after switching tab

---