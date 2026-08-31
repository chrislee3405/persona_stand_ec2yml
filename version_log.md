
---
# version 0.4.2

- faster preload of first image
- minor UI improvement

---
# version 0.4.1

- estabulish database to store static content
- estabulish S3 and CloudFront for owner image and other resources
- improve UI
    - combine about me, qualification and journey into one page
    - sustain nav bar on top
    - follow user scroll to highlight button in nav bar
- fix bug
    - incorrect highlighting in nav bar

---
# version 0.4.0 (all updates from 0.3.1 to 0.3.3)

- user consent function for data collection
- privacy gate
- Rate control
- Message length gate
- differentiate capacity of different user tier
- consent acceptance criteria
- Combine fragment messages before sending to backend
- split bukly chatroom code 
- fix bug of 2 close messages

---
# version 0.3.3

- Combine fragment messages before sending to backend
    - frontend logic
    - typing detect
- split bukly chatroom code 

---
# version 0.3.2

- differentiate capacity of different user tier
    - rate control
    - regenerate appempt
- consent acceptance criteria
    - compulsory consent terms in consent http request 
- fix bug of 2 close messages
    - add a linked list chain of messages in frontend

---
# version 0.3.1

- user consent function for data collection
    - consent popup window
        - pull agreement condition from database
    - consent record
    - consent blocker for message handling
        - both backend and frontend
- privacy gate
    - block privay containing message before entering database and third party LLM
        - spacy nlp engine
- Rate control
    - cap of 3 in-flight messages per session
    - cap of 5 concurrent session per IP
- Message length gate

---
# version 0.3.0 (all updates from 0.2.1 to 0.2.3)

- improve BM25 workflow
- check gate
- response parser
- prompt construction architecture
- improve workflow of logging error model message
- change behaviour of unanthentication conversation id and invite code

---
# version 0.2.3

- improve BM25 workflow
    - new table to store computed corpus
    - put corpus in cache memory at the beginning

---
# version 0.2.2

- check gate
    - check AI response consistency before sending back
    - few turns retry
        - minor retry with original response and reject reason only
        - major retry with complete background and reject reason
    - log retry attempt message in message table
        - sender: regen
- response parser
    - parse paragraph into sentence list
    - frontend delay response display for mimic human typing

---
# version 0.2.1

- prompt construction architecture
    - system prompt
        - unchange status information orientated
    - user prompt
        - dynamic and situtional information orientated
- improve workflow of logging error model message
    - log error model message in message table
        - sender: error
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
# version format x.y.z
- x is the major version
- y is the major function update
- z is the minor bug fix or minor function update(toward the major function update)
---
