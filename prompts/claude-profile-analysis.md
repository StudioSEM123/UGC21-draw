# Claude Profile Analysis Prompt
## For 21Draw UGC Creator Evaluation

### Usage
This prompt is used in WF3-AI-Analysis to evaluate Instagram creator profiles.
Copy this into the n8n HTTP Request node that calls the Anthropic API.

---

### Prompt

Evaluate this Instagram creator for potential UGC partnership with 21Draw, an online art education platform.

PROFILE DATA:
Username: {username}
Followers: {followers}
Engagement Rate: {engagement_rate}%
Avg Likes: {avg_likes}
Avg Comments: {avg_comments}
Bio: {bio}
Verified: {verified}
Business Category: {business_category}
Total Reels Found: {total_reels_found}

TOP REELS:
Reel 1: {reel_1_url}
- Likes: {reel_1_likes} | Comments: {reel_1_comments}
- Caption: {reel_1_caption}

Reel 2: {reel_2_url}
- Likes: {reel_2_likes} | Comments: {reel_2_comments}
- Caption: {reel_2_caption}

Reel 3: {reel_3_url}
- Likes: {reel_3_likes} | Comments: {reel_3_comments}
- Caption: {reel_3_caption}

EVALUATION CRITERIA:
- Niche relevance to art education (drawing, painting, sculpting, digital art, art tutorials)
- Engagement quality (likes, comments relative to followers)
- Content style fit for educational art platform
- Follower count (accounts with 5k+ followers in art niche are valuable)
- Even accounts with lower engagement rates should be COLLABORATE if they have strong art content and decent following

Recommendation options:
- COLLABORATE: Strong fit, good metrics, art-relevant content
- REVIEW: Promising but needs manual review
- PASS: Not a good fit for 21Draw
- REJECT: Clearly unsuitable (spam, no art content, very low following)

Respond with JSON only, no other text:
{"niche_relevance": 1-10, "profile_score": 1-10, "recommendation": "COLLABORATE/REVIEW/PASS/REJECT", "reasoning": "your explanation here"}
