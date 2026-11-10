// Shared fixtures for tests. All data here is fictional.
const filled = {
  candidate: { name: "Jordan Reyes", contact: "jordan@example.com · (555) 010-0199 · Chicago, IL" },
  search: {
    companies: [{ name: "Acme", ats: "greenhouse", slug: "acme" }],
    titleKeywords: ["product manager"],
    locationKeywords: [],
    pay: { minTop: 0, minBaseTop: 0 },
  },
};

// A fresh copy each call, so one test can't change another's settings.
export const filledSettings = () => structuredClone(filled);

// Enough real text (580 characters under a heading) for profileFilledIn to say yes.
export const LONG_PROFILE = "## Senior PM, Larkfield\n" + "Shipped things with numbers. ".repeat(20);
