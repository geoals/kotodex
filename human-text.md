# Actual text written by a living human being

## Core features 
- Overlay with popup-dictionary for reading visual novels. 
    No texthooking or OCR so it is purely a frontend for texthookers. You can customize font, font size, color, shadow, positioning, backdrop transparency etc.
- LLM-powered translation and explanation of the current line. (Bring your own API key)
- LLM-generated definition of the target word when adding Anki-cards. Dictionaries are very general, while the LLM is very good at adding extra nuance and context to the word, based on the context and how it is used in the specific sentence.
- All read lines are stored, 
- Stats of your reading (visual novels and physical books). Number of characters and minutes read per day, Raw reading speed (accounting for dictionary lookups), kanji and vocabulary count etc.

## What it does
Kotodex is built around a central concept of logging every line of text you read (and even logging dictionary lookups), so that we can build stats around this. Not only logging how many characters or pages was read, but the actual text. This means 

## Rambling

This project started with me wanting to make a more seamless sentence-mining and reading experience for myself on Linux, with focus on visual novels. There are a lot of tools for this already, but most are mainly for Windows. 

Another part of it is that code has become so incredibly cheap with how good AI models have become, so I would rather build something myself that can be exactly how I want it, than use someone eles tools that might or might not fit my needs. 
