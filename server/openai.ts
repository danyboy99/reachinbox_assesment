import { OpenAI } from "openai";

const openai = new OpenAI();
// Function to analyze email content using OpenAI
export const analyzeEmailContent = async (emailContent: string) => {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant.",
        },
        {
          role: "user",
          content: `Analyze the following email content and determine if the sender is Interested, Not Interested, or wants More Information:\n\n${emailContent}`,
        },
      ],
    });

    const analysis = response.choices[0].message;
    return analysis || "Unknown";
  } catch (error) {
    console.error("Error analyzing email content:", error);
    return "Unknown";
  }
};
