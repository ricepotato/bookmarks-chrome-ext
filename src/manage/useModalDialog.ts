import { useEffect, useRef } from "react";

/**
 * 편집 팝업용 모달 dialog. 마운트되면 모달로 열고, 팝업 바깥(배경)을 누르면 onClose를 부른다.
 * 반환값을 <dialog>에 그대로 펼쳐 넣는다: <dialog {...dialogProps}>
 *
 * 모달 dialog의 배경을 누르면 이벤트 대상이 dialog 자신이 되므로, 누른 위치가 dialog 상자
 * 밖인지로 판별한다. 팝업 안에서 글자를 드래그해 선택하다 바깥에서 놓은 경우에는 닫지 않도록
 * 누르기 시작한 위치도 확인한다. busy인 동안(저장/삭제 중)에는 결과를 봐야 하므로 닫지 않는다.
 */
export function useModalDialog(onClose: () => void, busy: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  const pressedOutsideRef = useRef(false);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const isOutside = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target !== e.currentTarget) return false;
    const rect = e.currentTarget.getBoundingClientRect();
    return (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    );
  };

  return {
    ref,
    // Esc로 닫을 때도 onClose가 호출되도록 close 이벤트를 받는다.
    onClose,
    onMouseDown: (e: React.MouseEvent<HTMLDialogElement>) => {
      pressedOutsideRef.current = isOutside(e);
    },
    onClick: (e: React.MouseEvent<HTMLDialogElement>) => {
      const outside = pressedOutsideRef.current && isOutside(e);
      pressedOutsideRef.current = false;
      if (outside && !busy) onClose();
    },
  };
}
