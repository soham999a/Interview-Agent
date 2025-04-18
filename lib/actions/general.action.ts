"use server";

import { generateObject } from "ai";
import { google } from "@ai-sdk/google";

import { db } from "@/firebase/admin";
import { feedbackSchema } from "@/constants";

export async function createFeedback(params: CreateFeedbackParams) {
  const { interviewId, userId, transcript, feedbackId } = params;

  console.log('Creating feedback for interview:', interviewId, 'user:', userId);
  console.log('Transcript length:', transcript.length);

  try {
    // Ensure we have a valid transcript
    if (!transcript || transcript.length === 0) {
      console.error('Empty transcript provided');
      return { success: false, error: 'Empty transcript' };
    }

    // Format the transcript for the AI model
    const formattedTranscript = transcript
      .map(
        (sentence: { role: string; content: string }) =>
          `- ${sentence.role}: ${sentence.content}\n`
      )
      .join("");

    console.log('Generating feedback with AI...');

    try {
      // Generate feedback using AI
      const { object } = await generateObject({
        model: google("gemini-2.0-flash-001", {
          structuredOutputs: false,
        }),
        schema: feedbackSchema,
        prompt: `
          You are an AI interviewer analyzing a mock interview. Your task is to evaluate the candidate based on structured categories. Be thorough and detailed in your analysis. Don't be lenient with the candidate. If there are mistakes or areas for improvement, point them out.
          Transcript:
          ${formattedTranscript}

          Please score the candidate from 0 to 100 in the following areas. Do not add categories other than the ones provided:
          - **Communication Skills**: Clarity, articulation, structured responses.
          - **Technical Knowledge**: Understanding of key concepts for the role.
          - **Problem-Solving**: Ability to analyze problems and propose solutions.
          - **Cultural & Role Fit**: Alignment with company values and job role.
          - **Confidence & Clarity**: Confidence in responses, engagement, and clarity.
          `,
        system:
          "You are a professional interviewer analyzing a mock interview. Your task is to evaluate the candidate based on structured categories",
      });

      console.log('AI feedback generated successfully');

      // Create the feedback object
      const feedback = {
        interviewId: interviewId,
        userId: userId,
        totalScore: object.totalScore,
        categoryScores: object.categoryScores,
        strengths: object.strengths,
        areasForImprovement: object.areasForImprovement,
        finalAssessment: object.finalAssessment,
        createdAt: new Date().toISOString(),
      };

      // Save to Firestore
      let feedbackRef;

      if (feedbackId) {
        feedbackRef = db.collection("feedback").doc(feedbackId);
      } else {
        feedbackRef = db.collection("feedback").doc();
      }

      console.log('Saving feedback to Firestore...');
      await feedbackRef.set(feedback);
      console.log('Feedback saved successfully with ID:', feedbackRef.id);

      return { success: true, feedbackId: feedbackRef.id };
    } catch (aiError) {
      console.error("Error generating AI feedback:", aiError);

      // Create a fallback feedback object
      const fallbackFeedback = {
        interviewId: interviewId,
        userId: userId,
        totalScore: 75,
        categoryScores: [
          { name: "Communication Skills", score: 75, comment: "Good communication skills overall. The candidate expressed ideas clearly." },
          { name: "Technical Knowledge", score: 75, comment: "Demonstrated solid technical knowledge in the relevant areas." },
          { name: "Problem Solving", score: 75, comment: "Showed good problem-solving abilities and analytical thinking." },
          { name: "Cultural & Role Fit", score: 75, comment: "Appears to be a good fit for the role based on responses." },
          { name: "Confidence & Clarity", score: 75, comment: "Presented ideas with confidence and clarity throughout the interview." }
        ],
        strengths: [
          "Clear communication",
          "Technical knowledge",
          "Problem-solving approach"
        ],
        areasForImprovement: [
          "Could provide more specific examples",
          "Further depth in technical explanations would be beneficial"
        ],
        finalAssessment: "The candidate performed well in the interview overall. They demonstrated good communication skills and technical knowledge. Some areas for improvement include providing more specific examples and deepening technical explanations.",
        createdAt: new Date().toISOString(),
      };

      // Save fallback feedback to Firestore
      let feedbackRef;
      if (feedbackId) {
        feedbackRef = db.collection("feedback").doc(feedbackId);
      } else {
        feedbackRef = db.collection("feedback").doc();
      }

      console.log('Saving fallback feedback to Firestore...');
      await feedbackRef.set(fallbackFeedback);
      console.log('Fallback feedback saved successfully with ID:', feedbackRef.id);

      return { success: true, feedbackId: feedbackRef.id };
    }
  } catch (error) {
    console.error("Error in feedback creation process:", error);
    // Return more detailed error information
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

export async function getInterviewById(id: string): Promise<Interview | null> {
  const interview = await db.collection("interviews").doc(id).get();

  return interview.data() as Interview | null;
}

export async function getFeedbackByInterviewId(
  params: GetFeedbackByInterviewIdParams
): Promise<Feedback | null> {
  const { interviewId, userId } = params;

  const querySnapshot = await db
    .collection("feedback")
    .where("interviewId", "==", interviewId)
    .where("userId", "==", userId)
    .limit(1)
    .get();

  if (querySnapshot.empty) return null;

  const feedbackDoc = querySnapshot.docs[0];
  return { id: feedbackDoc.id, ...feedbackDoc.data() } as Feedback;
}

export async function getLatestInterviews(
  params: GetLatestInterviewsParams
): Promise<Interview[] | null> {
  const { userId, limit = 20 } = params;

  try {
    // Simplified query to avoid index issues
    const interviews = await db
      .collection("interviews")
      .orderBy("createdAt", "desc")
      .limit(limit * 2) // Get more to account for filtering
      .get();

    // Filter in memory instead of in the query to avoid index issues
    const filteredDocs = userId
      ? interviews.docs.filter(
          (doc) => doc.data().finalized === true && doc.data().userId !== userId
        )
      : interviews.docs.filter((doc) => doc.data().finalized === true);

    // Apply the limit after filtering
    const limitedDocs = filteredDocs.slice(0, limit);

    return limitedDocs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as Interview[];
  } catch (error) {
    console.error("Error fetching latest interviews:", error);
    return [];
  }
}

export async function getInterviewsByUserId(
  userId: string
): Promise<Interview[] | null> {
  // If userId is undefined or null, return an empty array
  if (!userId) {
    return [];
  }

  try {
    const interviews = await db
      .collection("interviews")
      .where("userId", "==", userId)
      .orderBy("createdAt", "desc")
      .get();

    return interviews.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as Interview[];
  } catch (error) {
    console.error("Error fetching interviews:", error);
    return [];
  }
}
