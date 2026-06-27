import { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

const getActiveMembers = (members: any[]) => members.filter(m => !m.deletedAt && !m.deleted);

export const useFirestoreMembers = () => {
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setLoading(true);
    try {
      const unsubscribe = onSnapshot(
        collection(db, 'members'),
        (querySnapshot) => {
          const membersList = querySnapshot.docs
            .map(doc => {
              const data = doc.data();
              return {
                id: data.id || doc.id,
                docId: doc.id,
                ...data
              };
            })
            .reduce((acc: any[], member: any) => {
              if (!member.deleted && !member.deletedAt && acc.findIndex(x => x.id === member.id) === -1) {
                acc.push(member);
              }
              return acc;
            }, []);

          if (isMountedRef.current) {
            setMembers(membersList);
            setError(null);
            setLoading(false);
          }
        },
        (error) => {
          if (isMountedRef.current) {
            setError(error.message);
            setLoading(false);
            const saved = localStorage.getItem('members');
            if (saved) setMembers(JSON.parse(saved));
          }
        }
      );

      return () => unsubscribe();
    } catch (error: any) {
      if (isMountedRef.current) {
        setError(error.message);
        setLoading(false);
      }
    }
  }, []);

  return { members, loading, error, active: getActiveMembers(members) };
};
