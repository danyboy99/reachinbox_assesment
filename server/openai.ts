import { OpenAI } from "openai";
import dotenv from "dotenv";

dotenv.config();

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

// Function to generate an automated response based on analysis
const generateResponse = async (analysis: string, emailContent: string) => {
  let prompt = `Generate a reply for an email with the following content:\n\n${emailContent}\n\n`;
  if (analysis.includes("Interested")) {
    prompt += "The sender is interested and wants to know more.";
  } else if (analysis.includes("Not Interested")) {
    prompt += "The sender is not interested.";
  } else if (analysis.includes("More Information")) {
    prompt += "The sender wants more information.";
  }

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
          content: prompt,
        },
      ],
      max_tokens: 100,
    });

    const reply = response.choices[0].message;
    return reply || "";
  } catch (error) {
    console.error("Error generating response:", error);
    return "";
  }
};
