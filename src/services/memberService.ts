import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';

export interface Member {
  id?: string;
  docId?: string;
  fullName: string;
  email: string;
  phone: string;
  dateOfBirth?: string;
  amount?: number;
  paymentStatus?: 'pending' | 'verified' | 'rejected';
  deletedAt?: string;
  deleted?: boolean;
  [key: string]: any;
}

export const memberService = {
  async addMember(memberData: Omit<Member, 'id' | 'docId'>) {
    try {
      const docRef = await addDoc(collection(db, 'members'), {
        ...memberData,
        email: memberData.email.toLowerCase(),
        createdAt: new Date().toISOString(),
        paymentStatus: 'pending',
      });
      return { success: true, docId: docRef.id };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },

  async updateMember(docId: string, updates: Partial<Member>) {
    try {
      const memberRef = doc(db, 'members', docId);
      await updateDoc(memberRef, {
        ...updates,
        updatedAt: new Date().toISOString(),
      });
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },

  async deleteMember(docId: string) {
    try {
      const memberRef = doc(db, 'members', docId);
      await updateDoc(memberRef, {
        deleted: true,
        deletedAt: new Date().toISOString(),
      });
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },

  async checkDuplicateEmail(email: string) {
    try {
      const q = query(
        collection(db, 'members'),
        where('email', '==', email.toLowerCase()),
        where('deleted', '==', false)
      );
      const docs = await getDocs(q);
      return docs.size > 0;
    } catch (error) {
      console.error('Error checking duplicate email:', error);
      return false;
    }
  },

  async checkDuplicatePhone(phone: string) {
    try {
      const q = query(
        collection(db, 'members'),
        where('phone', '==', phone),
        where('deleted', '==', false)
      );
      const docs = await getDocs(q);
      return docs.size > 0;
    } catch (error) {
      console.error('Error checking duplicate phone:', error);
      return false;
    }
  },

  async verifyPayment(memberId: string, amount: number) {
    try {
      if (!amount || amount <= 0) {
        throw new Error('Amount must be greater than 0');
      }
      const memberRef = doc(db, 'members', memberId);
      await updateDoc(memberRef, {
        paymentStatus: 'verified',
        verifiedAt: new Date().toISOString(),
      });
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },

  async rejectPayment(memberId: string) {
    try {
      const memberRef = doc(db, 'members', memberId);
      await updateDoc(memberRef, {
        paymentStatus: 'rejected',
        rejectedAt: new Date().toISOString(),
      });
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};
