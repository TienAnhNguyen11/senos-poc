import { Router } from 'express';
import { login } from '../services/authService';
import { getInviteEmail, acceptInvite } from '../services/inviteService';

export const authRouter = Router();

authRouter.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const token = await login(email, password);
    res.json({ token });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/invites/:token', async (req, res, next) => {
  try {
    const email = await getInviteEmail(req.params.token);
    res.json({ email });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/invites/:token/accept', async (req, res, next) => {
  try {
    const { password } = req.body;
    const token = await acceptInvite(req.params.token, password);
    res.json({ token });
  } catch (err) {
    next(err);
  }
});
