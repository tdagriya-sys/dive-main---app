import { Request, Response } from "express";
import { ContactSubmission } from "../models/ContactSubmission";
import { contactSubmissionSchema } from "../validators/contact";

export async function submit(req: Request, res: Response) {
  const data = contactSubmissionSchema.parse(req.body);

  await ContactSubmission.create({ ...data, ip: req.ip });

  return res.status(201).json({ message: "Thanks — we've got your message and will get back to you soon." });
}
