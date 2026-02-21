# Claude Profile Analysis Prompt
## For 21Draw Creator Evaluation (UGC + Course Teachers)

### Usage
This prompt is used in WF3-AI-Analysis to evaluate Instagram creator profiles.
Copy this into the n8n HTTP Request node that calls the Anthropic API.
**Prompt version: 2** (added course teacher evaluation)

---

### Prompt

Evaluate this Instagram creator for 21Draw, an online art education platform with 2M+ students.

PROFILE DATA:
Username: {username}
Followers: {followers}
Engagement Rate: {engagement_rate}%
Avg Likes: {avg_likes}
Avg Comments: {avg_comments}
Bio: {bio}
Verified: {verified}
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

UGC CREATOR FIT:
- Niche relevance to art education (drawing, painting, sculpting, digital art, art tutorials)
- Engagement quality (likes, comments relative to followers)
- Content style fit for educational art platform
- Follower count (accounts with 5k+ followers in art niche are valuable)
- Even accounts with lower engagement rates should score well if they have strong art content and decent following

COURSE TEACHER FIT:
- Could this person teach a full online course on their art specialty?
- Professional industry experience mentioned in bio (studio work, freelance clients, publications)
- Published work (books, comics, games, exhibitions)
- Teaching signals in captions ("how to", "tutorial", "step by step", "learn", "process")
- YouTube channel, Skillshare, or course platform links in bio
- High production quality in reels
- Art specialties that match 21Draw's catalog: character design, concept art, digital illustration, comic art, traditional painting, anatomy, figure drawing
- Higher follower counts (50K+) are typical for course teacher candidates but not required

PROFILE TYPE SUGGESTION:
Based on your scores, suggest which type fits best:
- UGC_CREATOR: Strong UGC fit (profile_score >= 6) but lower teaching fit (course_teacher_score < 6)
- COURSE_TEACHER: Strong teaching fit (course_teacher_score >= 6) but lower UGC fit (profile_score < 6)
- BOTH: Strong fit for both (both scores >= 6)
- If both scores are low, still categorize based on which is higher

Recommendation options:
- COLLABORATE: Strong fit for UGC, teaching, or both
- REVIEW: Promising but needs manual review
- PASS: Not a good fit for 21Draw
- REJECT: Clearly unsuitable (spam, no art content, very low following)

Respond with JSON only, no other text:
{"niche_relevance": 1-10, "profile_score": 1-10, "course_teacher_score": 1-10, "suggested_type": "UGC_CREATOR/COURSE_TEACHER/BOTH", "recommendation": "COLLABORATE/REVIEW/PASS/REJECT", "reasoning": "your explanation covering both UGC and teaching potential"}
